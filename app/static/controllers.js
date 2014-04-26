/* Controllers */

angular.module('triage.controllers', [])

.controller('AppController', function($scope, $http, $location, ratelimit) {
    $scope.ratelimit = ratelimit.get;
})

.controller('FormController', function($scope, $location) {
    $scope.submitForm = function() {
        $location.path('/' + this.owner + '/' + this.repo);
    };
})

.controller('PullsController', function($scope, $http, $routeParams, $location, ratelimit) {
    'use strict';

    $scope.owner = $routeParams.owner;
    $scope.repo = $routeParams.repo;
    $scope.use_assigned = !$routeParams['hide-assigned'];
    $scope.bugs = {};

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
        $location.search('hide-assigned', '1');
        $scope.use_assigned = false;
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

    function loadComments(pull) {
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
            nanobar_level += nanobar_increments;
            nanobar.go(nanobar_level);
        });
    }

    function loadStatuses(pull) {
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
            nanobar_level += nanobar_increments;
            nanobar.go(nanobar_level);
        });
    }

    function loadCommits(pull) {
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
            // console.log('COMMITS');
            // console.dir(data);
        })
        .error(function(data, status) {
            console.warn(data, status);
        })
        .finally(function() {
            nanobar_level += nanobar_increments;
            nanobar.go(nanobar_level);
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

    function loadPulls(owner, repo) {
        $http
        .get('/githubproxy/repos/' + owner + '/' + repo + '/pulls?state=open')
        .success(function(data, status, headers) {
            //console.dir(data);
            var pulls = [];
            var bugs = [];
            if (data._ratelimit_limit) {
                ratelimit.update(data._ratelimit_limit, data._ratelimit_remaining);
            }
            // console.dir($scope.ratelimit);
            nanobar_increments = 50 / (data._data.length * 3);
            var big_nanobar_increments = 50 / data._data.length;
            _.each(data._data, function(pull) {
                pull._bugs = findBugNumbers(pull.title);
                bugs = _.union(bugs, pull._bugs);
                pull._last_user = pull.user;
                pull._last_user_time = pull.created_at;
                setLastActor(pull);
                pulls.push(pull);
                //console.log('URL1', pull.comments_url);
                loadComments(pull);
                loadStatuses(pull);
                loadCommits(pull);

                nanobar_level += big_nanobar_increments;
                nanobar.go(nanobar_level);
            });
            $scope.pulls = pulls;
            // console.log('ALL BUGS', bugs);
            $http
            .get('/bugzillaproxy/bug?id=' + bugs.join(',') + '&include_fields=summary,id,status,resolution,is_open')
            .success(function(data, status) {
                // console.log(data);
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
            $scope.loading = false;
        });
    }
    var nanobar = new Nanobar();
    var nanobar_increments = null;
    var nanobar_level = 0;

    $scope.loading = true;
    loadPulls($scope.owner, $scope.repo);

})
;
