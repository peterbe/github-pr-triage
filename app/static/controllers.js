/* Utility functions */

function truncate(s, l) {
    if (s.length > l) {
        return s.substring(0, l).trim() + '...';
    }
    return s;
}

function findBugNumbers(title) {
    var re = /\b[0-9]{6,10}\b/;
    var bugs = [];
    _.each(re.exec(title), function(bug) {
        bugs.push(bug);
    });
    return bugs;
}


/* Controllers */

var app = angular.module('triage.controllers', ['classy']);

app.classy.controller({
    name: 'AppController',
    inject: ['$scope', '$http', '$location', 'ratelimit'],
    init: function() {
        this.$.ratelimit = this.ratelimit.get;
    }
});

app.classy.controller({
    name: 'FormController',
    inject: ['$scope', '$location'],
    init: function() {},
    submitForm: function() {
        var repos = [];
        this.$.repos.split(',').forEach(function(repo) {
            repos.push(repo.trim());
        });
        this.$location.path('/' + this.$.owner.trim() + ':' + repos.join(','));
    }
});

app.classy.controller({
    name: 'PullsController',
    inject: ['$scope', '$http', '$routeParams', '$location', 'ratelimit'],
    init: function() {
        'use strict';

        if (this.$routeParams.owner && this.$routeParams.repo) {
            // legacy case
            this.$scope.owners = [this.$routeParams.owner];
            this.$scope.repos = [this.$routeParams.repo];
        } else {
            var owners = [];
            var repos = [];
            this.$routeParams.wildcard.split(';').forEach(function(each) {
                var owner = each.split(':')[0];
                var owner_repos = each.split(':')[1].split(',');
                owner_repos.forEach(function(owner_repo) {
                    owners.push(owner);
                    repos.push(owner_repo);
                });
            });
            this.$scope.owners = owners;
            this.$scope.repos = repos;
        }
        this.$scope.use_assigned = this.$location.hash().indexOf('hide-assigned') === -1;
        this.$scope.use_bug = this.$location.hash().indexOf('hide-bug') === -1;

        this.$scope.bugs = {};

        this.nanobar = new Nanobar();
        this.nanobar_level = 0;

        this.$scope.loading = true;
        this.$scope.groups = [];
        // there are 4 requests we need to make per project
        this.$scope.owners.forEach(function(owner, i) {
            var group = {
                owner: owner,
                repo: this.$scope.repos[i],
                loading: true,
                pulls: []
            };
            this.loadPulls(group, 100 / this.$scope.owners.length);
            this.$scope.groups.push(group);
        }, this);

    },

    submitForm: function() {
        var repos = [];
        var new_owner = this.$.new_owner.trim();
        this.$.new_repos.split(',').forEach(function(repo) {
            this.$scope.owners.push(new_owner);
            this.$scope.repos.push(repo.trim());
        }, this);

        this.$location.path(this._newPath(this.$scope.owners, this.$scope.repos));
    },

    _newPath: function(owners, repos) {
        var path = '/';
        var prev_owner = null;
        owners.forEach(function(owner, i) {
            if (prev_owner != owner) {
                if (prev_owner !== null) {
                    path += ';';
                }
                path += owner + ':';
            } else {
                path += ',';
            }
            path += repos[i];
            prev_owner = owner;
        });
        return path;
    },

    removeGroup: function(owner, repo) {
        var new_owners = [], new_repos = [];
        this.$scope.owners.forEach(function(each_owner, i) {
            if (!(each_owner === owner && this.$scope.repos[i] === repo)) {
                new_owners.push(each_owner);
                new_repos.push(this.$scope.repos[i]);
            }
        }, this);
        this.$location.path(this._newPath(new_owners, new_repos));
    },

    toggleExpandPull: function(pull) {
        if (!pull._expanded) {
            pull._events = this.$scope.getEvents(pull);
        }
        pull._expanded = !pull._expanded;
    },


    hideAssigned: function() {
        if (!this.$scope.use_bug) {
            this.$location.hash('hide-bug,hide-assigned');
        } else {
            this.$location.hash('hide-assigned');
        }
        this.$scope.use_assigned = false;
    },

    hideBug: function() {
        if (!this.$scope.use_assigned) {
            this.$location.hash('hide-bug,hide-assigned');
        } else {
            this.$location.hash('hide-bug');
        }
        this.$scope.use_bug = false;
    },

    getEvents: function(pull) {
        var events = [];

        _.each(pull._commits || [], function(commit) {
            // console.dir(commit);
            events.push({
                _type: 'commit',
                _url: commit.html_url,
                _summary: truncate(commit.commit.message, 80),
                _date: commit.commit.author.date
            });
        });
        _.each(pull._statuses || [], function(status) {
            //console.dir(status);
            events.push({
                _type: 'status-' + status.state,
                _url: status.target_url,
                _summary: status.description,
                _date: status.created_at
            });
        });
        _.each(pull._comments || [], function(comment) {
            //console.dir(comment);
            events.push({
                _type: 'comment',
                _summary: '(by @' + comment.user.login +') ' + truncate(comment.body, 80),
                _url: comment.html_url,
                _date: comment.created_at
            });
        });
        //console.dir(events);
        //return [];
        return events;
    },

    makeBugTitle: function(id) {
        id = +id;
        return this.$scope.bugs[id] && this.$scope.bugs[id].summary || '';
    },

    isClosed: function(id) {
        id = +id;
        return this.$scope.bugs[id] && !this.$scope.bugs[id].is_open || null;
    },

    uniqueUsers: function(pull) {
        var users = [];
        var userids = {};
        userids[pull.user.id] = 1;
        users.push(pull.user);
        _.each(pull._comments, function(comment) {
            if (!userids[comment.user.id]) {
                users.push(comment.user);
                userids[comment.user.id] = 1;
            }
        });
        return users;
    },

    getStatuses: function(pull) {
        return pull._statuses || [];
    },

    countComments: function(pull) {
        return pull._comments && pull._comments.length || 0;
    },

    isMergeable: function(pull) {
        return !!pull.merge_commit_sha;
    },

    hasStatuses: function(pull) {
        return pull._statuses && pull._statuses.length;
    },

    isLastStatus: function(pull, state) {
        var statuses = pull._statuses || [];
        var last = statuses[0];  // confusing, I know
        return last.state === state;
    },

    loadComments: function(pull, callback) {
        this.$http
        .get('/githubproxy/' + pull.comments_url)
        .success(function(data) {
            if (data._ratelimit_limit) {
                this.ratelimit.update(data._ratelimit_limit, data._ratelimit_remaining);
            }
            pull._comments = data._data;
            if (pull._comments.length) {
                pull._last_comment = pull._comments[pull._comments.length - 1];
                this.setLastActor(pull);
            }
        }.bind(this))
        .error(function(data, status) {
            console.warn(data, status);
        })
        .finally(function() {
            if (callback) callback();
        });
    },

    loadStatuses: function(pull, callback) {
        this.$http
        .get('/githubproxy/' + pull.statuses_url)
        .success(function(data) {
            if (data._ratelimit_limit) {
                this.ratelimit.update(data._ratelimit_limit, data._ratelimit_remaining);
            }
            pull._statuses = data._data;
        }.bind(this))
        .error(function(data, status) {
            console.warn(data, status);
        })
        .finally(function() {
            if (callback) callback();
        });
    },

    loadCommits: function(pull, callback) {
        this.$http
        .get('/githubproxy/' + pull.commits_url)
        .success(function(data) {
            if (data._ratelimit_limit) {
                this.ratelimit.update(data._ratelimit_limit, data._ratelimit_remaining);
            }
            pull._commits = data._data;
            if (pull._commits.length > 1) {
                pull._last_commit = pull._commits[pull._commits.length - 1];
                this.setLastActor(pull);
            }
        }.bind(this))
        .error(function(data, status) {
            console.warn(data, status);
        })
        .finally(function() {
            if (callback) callback();
        });
    },

    setLastActor: function(pull) {
        if (pull._last_commit && pull._last_comment) {
            // but who was first?!
            if (pull._last_commit.commit.date > pull._last_comment.created_at) {
                pull._last_actor = {
                    user: pull._last_commit.author,
                    type: "commit",
                    url: pull._last_commit.html_url
                };
            } else {
                pull._last_actor = {
                    user: pull._last_comment.user,
                    type: "comment",
                    url: pull._last_comment.html_url
                };
            }
        } else if (pull._last_commit) {
            pull._last_actor = {
                user: pull._last_commit.author,
                type: "commit",
                url: pull._last_commit.html_url
            };
        } else if (pull._last_comment) {
            pull._last_actor = {
                user: pull._last_comment.user,
                type: "comment",
                url: pull._last_comment.html_url
            };
        } else {
            pull._last_actor = {
                user: pull.user,
                type: "creation",
                url: pull.html_url
            };
        }
    },

    loadPulls: function(group, base_increment) {
        this.$http
        .get('/githubproxy/repos/' + group.owner + '/' + group.repo + '/pulls?state=open')
        .success(function(data, status, headers) {
            //console.dir(data);
            var pulls = [];
            var bugs = [];
            if (data._ratelimit_limit) {
                this.ratelimit.update(data._ratelimit_limit, data._ratelimit_remaining);
            }
            // To work out the increments for the nanobar, start with assuming
            // this group has 3 things it needs to do per pull request
            var increment = null;
            if (data._data.length) {
                increment = base_increment / (data._data.length * 3);
            }
            data._data.forEach(function(pull) {
                pull._bugs = findBugNumbers(pull.title);
                bugs = _.union(bugs, pull._bugs);
                pull._last_user = pull.user;
                pull._last_user_time = pull.created_at;
                this.setLastActor(pull);
                pulls.push(pull);
                this.loadComments(pull, function() {
                    this.nanobarIncrement(increment);
                    this.loadStatuses(pull, function() {
                        this.nanobarIncrement(increment);
                        this.loadCommits(pull, function() {
                            this.nanobarIncrement(increment);
                        });
                    });
                });
            }, this);
            group.pulls = pulls;
            this.$http
            .get('/bugzillaproxy/bug?id=' + bugs.join(',') + '&include_fields=summary,id,status,resolution,is_open')
            .success(function(data, status) {
                var bugs = {};
                _.each(data.bugs, function(bug) {
                    bugs[bug.id] = bug;
                });
                this.$scope.bugs = bugs;
            }.bind(this))
            .error(function(data, status) {
                console.warn(data, status);
            });
        }.bind(this))
        .error(function(data, status) {
        })
        .finally(function() {
            group.loading = false;
        });
    },

    nanobarIncrement: function(increment) {
        if (this.nanobar_level >= 100) {
            console.log('> 100');
            return;
        }
        this.nanobar_level += increment;
        this.nanobar.go(Math.min(100, Math.ceil(this.nanobar_level)));
    }

})
;
