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
DEBUG = os.environ.get('DEBUG', False) in ('true', '1')

app = Flask(__name__)
cache = MemcachedCache(MEMCACHE_URL)

@app.route('/')
def index_html():
    return send_file('index.html')


class ShasView(MethodView):

    def post(self):
        deployments = []
        for each in request.json:
            name = each['name']
            url = each['url']
            if '?' in url:
                url += '&'
            else:
                url += '?'
            url += 'cachescramble=%s' % time.time()
            content = urllib.urlopen(url).read().strip()
            if not 7 <= len(content) <= 40:
                # doesn't appear to be a git sha
                error = (
                    "Doesn't look like a sha\n (%s) on %s" %
                    (content, each['url'])
                )
                return make_response(jsonify({'error': error,}))
            deployments.append({
                'name': name,
                'sha': content,
                'bugs': []
            })
        response = make_response(jsonify({'deployments': deployments}))
        return response

class PullsView(MethodView):

    def get(self, owner, repo):
        url = 'https://api.github.com'
        url = urlformat(owner=owner, repo=repo)
        print url


class ProxyView(MethodView):

    expires = 60 * 60

    def get(self, path):
        path = '%s?%s' % (path, request.query_string)
        key = self.prefix + hashlib.md5(path).hexdigest()
        value = cache.get(key)
        #value = None
        if value:
            value = json.loads(value)
        else:
            print "LOADING", self.base + path
            response = requests.get(self.base + path)
            assert response.status_code == 200, response.status_code
            value = response.json()
            cache.set(key, json.dumps(value), self.expires)
        #print type(value)
        response = make_response(json.dumps(value))
        response.headers['content-type'] = 'application/json'
        return response


class GithubProxyView(ProxyView):

    prefix = 'github'
    base = 'https://api.github.com/'


class BugzillaProxyView(ProxyView):

    prefix = 'bugzilla'
    base = 'https://bugzilla.mozilla.org/rest/'


@app.route('/<path:path>')
def catch_all(path):
    path = path or 'index.html'
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
