#include "shim.h"

CURLcode fi_easy_setopt_long(CURL *curl, CURLoption option, long value) {
  return curl_easy_setopt(curl, option, value);
}

CURLcode fi_easy_setopt_off_t(CURL *curl, CURLoption option, curl_off_t value) {
  return curl_easy_setopt(curl, option, value);
}

CURLcode fi_easy_setopt_string(CURL *curl, CURLoption option, const char *value) {
  return curl_easy_setopt(curl, option, value);
}

CURLcode fi_easy_setopt_pointer(CURL *curl, CURLoption option, void *value) {
  return curl_easy_setopt(curl, option, value);
}

CURLcode fi_easy_setopt_slist(CURL *curl, CURLoption option, struct curl_slist *value) {
  return curl_easy_setopt(curl, option, value);
}

CURLcode fi_easy_setopt_write_callback(CURL *curl, curl_write_callback callback) {
  return curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, callback);
}

CURLcode fi_easy_setopt_header_callback(CURL *curl, curl_write_callback callback) {
  return curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, callback);
}

CURLcode fi_easy_getinfo_long(CURL *curl, CURLINFO info, long *value) {
  return curl_easy_getinfo(curl, info, value);
}

CURLcode fi_easy_getinfo_string(CURL *curl, CURLINFO info, char **value) {
  return curl_easy_getinfo(curl, info, value);
}

