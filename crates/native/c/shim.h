#ifndef FETCH_IMPERSONATE_SHIM_H
#define FETCH_IMPERSONATE_SHIM_H

#include <curl/curl.h>

#ifdef __cplusplus
extern "C" {
#endif

CURLcode fi_easy_setopt_long(CURL *curl, CURLoption option, long value);
CURLcode fi_easy_setopt_off_t(CURL *curl, CURLoption option, curl_off_t value);
CURLcode fi_easy_setopt_string(CURL *curl, CURLoption option, const char *value);
CURLcode fi_easy_setopt_pointer(CURL *curl, CURLoption option, void *value);
CURLcode fi_easy_setopt_slist(CURL *curl, CURLoption option, struct curl_slist *value);
CURLcode fi_easy_setopt_write_callback(CURL *curl, curl_write_callback callback);
CURLcode fi_easy_setopt_header_callback(CURL *curl, curl_write_callback callback);
CURLcode fi_easy_getinfo_long(CURL *curl, CURLINFO info, long *value);
CURLcode fi_easy_getinfo_string(CURL *curl, CURLINFO info, char **value);

#ifdef __cplusplus
}
#endif

#endif

