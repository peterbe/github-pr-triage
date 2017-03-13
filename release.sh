#!/bin/bash

set -e

grymt -w ./app
git push heroku master
