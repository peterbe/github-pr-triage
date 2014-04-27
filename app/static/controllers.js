/* Controllers */

angular.module('triage.controllers', [])

.controller('AppController',
    ['$scope', '$http', '$location', 'ratelimit',
    function($scope, $http, $location, ratelimit) {
    $scope.ratelimit = ratelimit.get;
}])

.controller('FormController',
    ['$scope', '$location',
    function($scope, $location) {
    $scope.submitForm = function() {
        var repos = [];
        this.repos.split(',').forEach(function(repo) {
            repos.push(repo.trim());
        });
        $location.path('/' + this.owner.trim() + ':' + repos.join(','));
    };
}])

.controller('PullsController',
    ['$scope', '$http', '$routeParams', '$location', 'ratelimit',
    function($scope, $http, $routeParams, $location, ratelimit) {
    'use strict';

    if ($routeParams.owner && $routeParams.repo) {
        // legacy case
        $scope.owners = [$routeParams.owner];
        $scope.repos = [$routeParams.repo];
    } else {
        var owners = [];
        var repos = [];
        $routeParams.wildcard.split(';').forEach(function(each) {
            var owner = each.split(':')[0];
            var owner_repos = each.split(':')[1].split(',');
            owner_repos.forEach(function(owner_repo) {
                owners.push(owner);
                repos.push(owner_repo);
            });
        });
        $scope.owners = owners;
        $scope.repos = repos;
    }
    $scope.use_assigned = $location.hash().indexOf('hide-assigned') === -1;
    $scope.use_bug = $location.hash().indexOf('hide-bug') === -1;

    $scope.bugs = {};

    $scope.submitForm = function() {
        var repos = [];
        var new_owner = this.new_owner.trim();
        this.new_repos.split(',').forEach(function(repo) {
            $scope.owners.push(new_owner);
            $scope.repos.push(repo.trim());
        });

        $location.path(_newPath($scope.owners, $scope.repos));

    };

    function _newPath(owners, repos) {
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
    }

    $scope.removeGroup = function(owner, repo) {
        var new_owners = [], new_repos = [];
        $scope.owners.forEach(function(each_owner, i) {

            if (!(each_owner === owner && $scope.repos[i] === repo)) {
                new_owners.push(each_owner);
                new_repos.push($scope.repos[i]);
            }
        });
        $location.path(_newPath(new_owners, new_repos));
    };

    $scope.toggleExpandPull = function(pull) {
        if (!pull._expanded) {
            pull._events = $scope.getEvents(pull);
        }
        pull._expanded = !pull._expanded;
    };

    function truncate(s, l) {
        if (s.length > l) {
            return s.substring(0, l).trim() + '...';
        }
        return s;
    }

    $scope.hideAssigned = function() {
        if (!$scope.use_bug) {
            $location.hash('hide-bug,hide-assigned');
        } else {
            $location.hash('hide-assigned');
        }
        $scope.use_assigned = false;
    };

    $scope.hideBug = function() {
        if (!$scope.use_assigned) {
            $location.hash('hide-bug,hide-assigned');
        } else {
            $location.hash('hide-bug');
        }
        $scope.use_bug = false;
    };

    $scope.getEvents = function(pull) {
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
    };

    function findBugNumbers(title) {
        var re = /\b[0-9]{6,10}\b/;
        var bugs = [];
        _.each(re.exec(title), function(bug) {
            bugs.push(bug);
        });
        return bugs;
    }

    $scope.makeBugTitle = function(id) {
        id = +id;
        return $scope.bugs[id] && $scope.bugs[id].summary || '';
    };
    $scope.isClosed = function(id) {
        id = +id;
        return $scope.bugs[id] && !$scope.bugs[id].is_open || null;
    };

    $scope.uniqueUsers = function(pull) {
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
    };
    $scope.getStatuses = function(pull) {
        return pull._statuses || [];
    };

    $scope.countComments = function(pull) {
        return pull._comments && pull._comments.length || 0;
    };

    $scope.isMergeable = function(pull) {
        return !!pull.merge_commit_sha;
    };

    $scope.hasStatuses = function(pull) {
        return pull._statuses && pull._statuses.length;
    };

    $scope.isLastStatus = function(pull, state) {
        var statuses = pull._statuses || [];
        var last = statuses[0];  // confusing, I know
        return last.state === state;
    };

    function loadComments(pull, callback) {
        $http
        .get('/githubproxy/' + pull.comments_url)
        .success(function(data) {
            if (data._ratelimit_limit) {
                ratelimit.update(data._ratelimit_limit, data._ratelimit_remaining);
            }
            pull._comments = data._data;
            if (pull._comments.length) {
                pull._last_comment = pull._comments[pull._comments.length - 1];
                setLastActor(pull);
            }
        })
        .error(function(data, status) {
            console.warn(data, status);
        })
        .finally(function() {
            if (callback) callback();
        });
    }

    function loadStatuses(pull, callback) {
        $http
        .get('/githubproxy/' + pull.statuses_url)
        .success(function(data) {
            if (data._ratelimit_limit) {
                ratelimit.update(data._ratelimit_limit, data._ratelimit_remaining);
            }
            pull._statuses = data._data;
        })
        .error(function(data, status) {
            console.warn(data, status);
        })
        .finally(function() {
            if (callback) callback();
        });
    }

    function loadCommits(pull, callback) {
        $http
        .get('/githubproxy/' + pull.commits_url)
        .success(function(data) {
            if (data._ratelimit_limit) {
                ratelimit.update(data._ratelimit_limit, data._ratelimit_remaining);
            }
            pull._commits = data._data;
            if (pull._commits.length > 1) {
                pull._last_commit = pull._commits[pull._commits.length - 1];
                setLastActor(pull);
            }
        })
        .error(function(data, status) {
            console.warn(data, status);
        })
        .finally(function() {
            if (callback) callback();
        });
    }

    function setLastActor(pull) {
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
    }

    function loadPulls(group, base_increment) {
        $http
        .get('/githubproxy/repos/' + group.owner + '/' + group.repo + '/pulls?state=open')
        .success(function(data, status, headers) {
            //console.dir(data);
            var pulls = [];
            var bugs = [];
            if (data._ratelimit_limit) {
                ratelimit.update(data._ratelimit_limit, data._ratelimit_remaining);
            }
            // To work out the increments for the nanobar, start with assuming
            // this group has 3 things it needs to do per pull request
            var increment = null;
            if (data._data.length) {
                increment = base_increment / (data._data.length * 3);
            }
            _.each(data._data, function(pull) {
                pull._bugs = findBugNumbers(pull.title);
                bugs = _.union(bugs, pull._bugs);
                pull._last_user = pull.user;
                pull._last_user_time = pull.created_at;
                setLastActor(pull);
                pulls.push(pull);
                loadComments(pull, function() {
                    nanobarIncrement(increment);
                    loadStatuses(pull, function() {
                        nanobarIncrement(increment);
                        loadCommits(pull, function() {
                            nanobarIncrement(increment);
                        });
                    });
                });
            });
            group.pulls = pulls;
            $http
            .get('/bugzillaproxy/bug?id=' + bugs.join(',') + '&include_fields=summary,id,status,resolution,is_open')
            .success(function(data, status) {
                var bugs = {};
                _.each(data.bugs, function(bug) {
                    bugs[bug.id] = bug;
                });
                $scope.bugs = bugs;
            })
            .error(function(data, status) {
                console.warn(data, status);
            });
        })
        .error(function(data, status) {
        })
        .finally(function() {
            group.loading = false;
        });
    }
    var nanobar = new Nanobar();
    var nanobar_level = 0;

    function nanobarIncrement(increment) {
        if (nanobar_level >= 100) return;
        nanobar_level += increment;
        nanobar.go(Math.min(100, Math.ceil(nanobar_level)));
    }

    $scope.loading = true;
    $scope.groups = [];
    // there are 4 requests we need to make per project
    $scope.owners.forEach(function(owner, i) {
        var group = {
            owner: owner,
            repo: $scope.repos[i],
            loading: true,
            pulls: []
        };
        loadPulls(group, 100 / $scope.owners.length);
        $scope.groups.push(group);
    });

}])
;
