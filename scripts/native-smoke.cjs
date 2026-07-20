const { createServer } = require("node:http");
const { resolve } = require("node:path");

const targetIndex = process.argv.indexOf("--target");
const target = targetIndex === -1 ? detectTarget() : process.argv[targetIndex + 1];
if (!target) throw new Error("--target requires a value");

const binding = require(resolve(__dirname, "..", "npm", `native-${target}`));
const version = binding.version();
if (!version.curl.includes("IMPERSONATE")) {
  throw new Error(`Unexpected libcurl version: ${version.curl}`);
}

(async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain", "x-native-smoke": target });
    response.end("native-smoke");
  });

  try {
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No server address");

    const chunks = [];
    let status;
    let transferId;
    await new Promise((resolveTransfer, rejectTransfer) => {
      const timer = setTimeout(() => {
        if (transferId !== undefined) binding.cancelRequest(transferId);
        rejectTransfer(new Error("Native smoke request timed out"));
      }, 10_000);

      const drain = () => {
        while (transferId !== undefined) {
          const chunk = binding.readBody(transferId);
          if (chunk === null) break;
          chunks.push(Buffer.from(chunk));
        }
      };

      transferId = binding.startRequest(
        {
          url: `http://127.0.0.1:${address.port}`,
          method: "GET",
          headers: [],
          redirect: "follow",
          options: { impersonate: "chrome", defaultHeaders: true },
        },
        (serialized) => {
          const event = JSON.parse(serialized);
          if (event.type === "headers") status = event.status;
          if (event.type === "body" || event.type === "complete") drain();
          if (event.type === "error") {
            clearTimeout(timer);
            rejectTransfer(new Error(`${event.error.kind}: ${event.error.message}`));
          } else if (event.type === "complete") {
            clearTimeout(timer);
            resolveTransfer();
          }
        },
      );
    });

    if (status !== 200 || Buffer.concat(chunks).toString() !== "native-smoke") {
      throw new Error(
        `Unexpected native response: status=${status}, body=${Buffer.concat(chunks)}`,
      );
    }
    console.log(`Native addon smoke test passed for ${target} (${version.curl}).`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function detectTarget() {
  if (process.platform === "win32") return `win32-${process.arch}-msvc`;
  if (process.platform === "darwin") return `darwin-${process.arch}`;
  if (process.platform === "android") return `android-${process.arch}`;
  if (process.platform === "linux") {
    const libc = process.report?.getReport()?.header?.glibcVersionRuntime ? "gnu" : "musl";
    const architecture = process.arch === "arm" ? "arm-gnueabihf" : process.arch;
    return `linux-${architecture}-${libc}`;
  }
  throw new Error(`Unsupported host: ${process.platform}-${process.arch}`);
}
