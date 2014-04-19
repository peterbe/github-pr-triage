# github-pr-triage
# VERSION 0.1

FROM ubuntu
MAINTAINER Bryan Larsen, bryan@larsen.st
WORKDIR /opt/github-pr-triage
RUN echo "deb http://archive.ubuntu.com/ubuntu precise main universe" > /etc/apt/sources.list
RUN apt-get update
RUN apt-get -y install python-pip
RUN apt-get -y install git # required for grymt

ADD . /opt/github-pr-triage
RUN pip install -r requirements.txt
RUN grymt -w ./app

EXPOSE 5000
ENTRYPOINT MEMCACHE_URL=$MEMCACHED_PORT_11211_TCP_ADDR:$MEMCACHED_PORT_11211_TCP_PORT python app.py
