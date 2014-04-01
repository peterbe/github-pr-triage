# Github PR Triage

A dashboard of Github Pull Requests

An example: [mozilla/socorro](https://prs.paas.allizom.org)

License: [MPL2](http://www.mozilla.org/MPL/2.0/)


## Installation

### Ubuntu

    sudo apt-get install python-pip memcached
    sudo pip install Flask python-memcached

generate a github oauth personal access token using
[instructions here](https://help.github.com/articles/creating-an-access-token-for-command-line-use)

    export GITHUB_OAUTH_TOKEN=<token>
    export MEMCACHE_URL=localhost:11211
    python app.py

point your browser at http://localhost:5000

## Deployment

You can deploy this on Stackato by simply running:


    stackato push

Now, before you do this you might want to make a "dist version" meaning a copy
of the `./app` directory made for production use. All CSS and JS is
concatenated and minified correctly. To do that you need to first:

    pip install grymt

Then run:

    grymt -w -s ./app

That will create a directory called "./dist" which will contain an optimized
`index.html` which the server app (`app.py`) knows to serve instead.
