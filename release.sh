#!/bin/bash

set -e

grymt -v ./app
git push heroku master
