#!/usr/bin/env python
import json
import time
import os
import urllib
import hashlib

import requests

from werkzeug.contrib.cache import MemcachedCache

from flask import Flask, request, make_response, abort, jsonify, send_file
from flask.views import MethodView


MEMCACHE_URL = os.environ.get('MEMCACHE_URL', '127.0.0.1:11211').split(',')
DEBUG = os.environ.get('DEBUG', False) in ('true', '1', 'y', 'yes')
GITHUB_OAUTH_TOKEN = os.environ.get('GITHUB_OAUTH_TOKEN')

app = Flask(__name__)
cache = MemcachedCache(MEMCACHE_URL)

@app.route('/')
def index_html():
    return send_file('index.html')


class ProxyView(MethodView):

    short_expires = 60 * 10  # when we serve straight from memcache
    long_expires = 60 * 60 * 24  # store long term

    def _attach_auth(self, headers):
        if GITHUB_OAUTH_TOKEN:
            headers['Authorization'] = 'token %s' % GITHUB_OAUTH_TOKEN

    def get(self, path):
        if '://' in path:
            assert path.startswith(self.base)
            path = path.replace(self.base, '')
        path = '%s?%s' % (path, request.query_string)
        key = self.prefix + hashlib.md5(path).hexdigest()
        short_key = 'short-' + key
        long_key = 'long-' + key
        value = cache.get(short_key)
        if value:
            value = json.loads(value)
        else:
            # do we have it in long-term memory? If so, do conditional get
            value = cache.get(long_key)
            if value:
                value = json.loads(value)
                # but is it out of date?
                # print "We have only a long-term storage of this"
                if value.get('_etag'):
                    headers = {'If-None-Match': value['_etag']}
                    self._attach_auth(headers)
                    # print path
                    # print headers
                    print "CONDITIONAL GET", self.base + path
                    response = requests.get(self.base + path, headers=headers)
                    if response.status_code == 304:
                        # it's still fresh!
                        cache.set(short_key, json.dumps(value), self.short_expires)
                        value['_ratelimit_limit'] = response.headers.get('X-RateLimit-Limit')
                        value['_ratelimit_remaining'] = response.headers.get('X-RateLimit-Remaining')
                    else:
                        value = None
                else:
                    # it's too old and we can't do a conditional get
                    value = None

            if not value:
                print "GET", self.base + path
                headers = {}
                self._attach_auth(headers)
                response = requests.get(self.base + path, headers=headers)

                assert response.status_code == 200, response.status_code

                value = response.json()
                if not isinstance(value, dict):
                    # if the JSON response is a list or something we can't
                    # attach extra stuff to it
                    value = {'_data': value}
                cache.set(short_key, json.dumps(value), self.short_expires)

                # we only need these for the long-storage stuff
                value['_etag'] = response.headers.get('ETag')
                #value['_last_modified'] = response.headers.get('Last-Modified')
                cache.set(long_key, json.dumps(value), self.long_expires)

                # these values aren't worth storing in the cache but
                # useful to return as part of the response
                value['_ratelimit_limit'] = response.headers.get('X-RateLimit-Limit')
                value['_ratelimit_remaining'] = response.headers.get('X-RateLimit-Remaining')

        return make_response(jsonify(value))


class GithubProxyView(ProxyView):

    prefix = 'github'
    base = 'https://api.github.com/'


class BugzillaProxyView(ProxyView):

    prefix = 'bugzilla'
    base = 'https://bugzilla.mozilla.org/rest/'


@app.route('/<path:path>')
def catch_all(path):
    path = path or 'index.html'
    # print "PATH", path
    if not (os.path.isdir(path) or os.path.isfile(path)):
        # print "\tdidn't exist"
        path = 'index.html'
    # return send_file('../dist/%s' % path)
    return send_file(path)


# app.add_url_rule('/pulls/:owner/:repo', view_func=PullsView.as_view('pulls'))
app.add_url_rule(
    '/githubproxy/<path:path>',
    view_func=GithubProxyView.as_view('githubproxy')
)
app.add_url_rule(
    '/bugzillaproxy/<path:path>',
    view_func=BugzillaProxyView.as_view('bugzillaproxy')
)

if __name__ == '__main__':
    app.debug = DEBUG
    port = int(os.environ.get('PORT', 5000))
    host = os.environ.get('HOST', '0.0.0.0')
    app.run(host=host, port=port)
