#!/usr/bin/env python
import json
import os
import hashlib

import requests

from flask import Flask, request, make_response, jsonify, send_file, abort
from flask.ext.cacheify import init_cacheify
from flask.views import MethodView


MEMCACHE_URL = os.environ.get('MEMCACHE_URL', '127.0.0.1:11211').split(',')
DEBUG = os.environ.get('DEBUG', False) in ('true', '1', 'y', 'yes')
GITHUB_OAUTH_TOKEN = os.environ.get('GITHUB_OAUTH_TOKEN')

APP_LOCATION = 'app'
if os.path.isdir('./dist') and os.listdir('./dist'):
    print "Note: Serving files from ./dist"
    APP_LOCATION = 'dist'


app = Flask(
    __name__,
    static_folder=os.path.join(APP_LOCATION, 'static')
)
cache = init_cacheify(app)

cache.set('cache', 'works :)', 10)
print 'Cache', cache.get('cache') or "doesn't work :("


class ProxyView(MethodView):

    # when we serve straight from memcache
    short_expires = 60 * 5  * (1 + 3 * int(DEBUG))
    # store long term
    long_expires = 60 * 60 * 24

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
        short_value, long_value = cache.get_many(*[short_key, long_key])
        if short_value:
            value = json.loads(short_value)
        elif long_value:
            value = json.loads(long_value)

            if value.get('_etag'):
                headers = {'If-None-Match': value['_etag']}
                self._attach_auth(headers)
                # print path
                # print headers
                print "CONDITIONAL GET", self.base + path
                response = requests.get(self.base + path, headers=headers)
                if response.status_code == 304:
                    # it's still fresh!
                    cache.set(
                        short_key,
                        json.dumps(value),
                        self.short_expires
                    )
                    value['_ratelimit_limit'] = (
                        response.headers.get('X-RateLimit-Limit')
                    )
                    value['_ratelimit_remaining'] = (
                        response.headers.get('X-RateLimit-Remaining')
                    )
                else:
                    value = None
            else:
                value = None
        else:
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
            # often when pulling down a pull request, the state of
            # whether the pull request is mergeable takes a while to figure
            # out so we don't want to cache that.
            if value.get('mergeable_state') != 'unknown':
                cache.set(short_key, json.dumps(value), self.short_expires)

            # we only need these for the long-storage stuff
            value['_etag'] = response.headers.get('ETag')

            # see comment about about possibly not caching based on mergeable_state
            if value.get('mergeable_state') != 'unknown':
                cache.set(long_key, json.dumps(value), self.long_expires)

            # these values aren't worth storing in the cache but
            # useful to return as part of the response
            value['_ratelimit_limit'] = (
                response.headers.get('X-RateLimit-Limit')
            )
            value['_ratelimit_remaining'] = (
                response.headers.get('X-RateLimit-Remaining')
            )

        return make_response(jsonify(value))


class GithubProxyView(ProxyView):

    prefix = 'github'
    base = 'https://api.github.com/'


class BugzillaProxyView(ProxyView):

    prefix = 'bugzilla'
    base = 'https://bugzilla.mozilla.org/rest/'


class Webhook(MethodView):

    def post(self):
        # print "Incoming webhook"
        payload = json.loads(request.form['payload'])
        # from pprint import pprint
        # pprint(payload)
        paths = []
        if payload.get('action') == 'opened' and payload.get('repository'):
            repo_full_name = payload['repository']['full_name']
            # print "FULL_NAME", repr(repo_full_name)
            paths.append('repos/%s/pulls?state=open' % repo_full_name)
        elif payload.get('action') == 'synchronize' and payload.get('pull_request'):
            # repo_full_name = payload['repository']['full_name']
            commits_url = payload.get('pull_request').get('commits_url')
            path = commits_url.replace(GithubProxyView.base, '')
            paths.append(path)
            paths.append(path + '?')

            comments_url = payload.get('pull_request').get('comments_url')
            path = comments_url.replace(GithubProxyView.base, '')
            paths.append(path)
            paths.append(path + '?')

        if payload.get('pull_request', {}).get('statuses_url'):
            statuses_url = payload['pull_request']['statuses_url']
            path = statuses_url.replace(GithubProxyView.base, '')
            paths.append(path)
            paths.append(path + '?')

        for path in paths:
            cache_key = self._path_to_cache_key(path)
            # print "CACHE_KEY", cache_key
            if cache.get(cache_key):
                print "\tDELETED", cache_key, 'FOR', path
                cache.delete(cache_key)

        if not paths:
            return make_response("No action\n")

        return make_response('OK\n')

    def _path_to_cache_key(self, path):
        return 'short-' + GithubProxyView.prefix + hashlib.md5(path).hexdigest()


app.add_url_rule(
    '/webhook',
    view_func=Webhook.as_view('webhook')
)


@app.route('/')
def index_html():
    return catch_all('index.html')


@app.route('/<path:path>')
def catch_all(path):
    if path == 'favicon.ico':
        path = 'static/favicon.ico'
    path = path or 'index.html'
    if '../' in path:  # trying to traverse up
        abort(404)
    path = os.path.join(APP_LOCATION, path)

    if not (os.path.isdir(path) or os.path.isfile(path)):
        path = os.path.join(APP_LOCATION, 'index.html')
    return send_file(path)


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
