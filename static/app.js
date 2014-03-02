angular.module('triage', ['ngRoute', 'angularMoment'])

.config(['$routeProvider', function ($routeProvider) {
    // $locationProvider.html5Mode(true);

    $routeProvider
    .when('/:owner/:repo', {
        templateUrl: "partials/table.html",
        controller: 'PullsController'
    })
    .when('/', {
        templateUrl: "partials/form.html",
        controller:'FormController'
    })
    ;
}])

.controller('AppController', function($scope, $http, $location) {
    $scope.pulls = [];

})

.controller('FormController', function($scope, $location) {
    $scope.submitForm = function() {
        $location.path('/' + this.owner + '/' + this.repo);
        //loadPulls(this.owner, this.repo);
    };
})

.controller('PullsController', function($scope, $http, $routeParams) {

    $scope.owner = $routeParams.owner;
    $scope.repo = $routeParams.repo;
    $scope.bugs = {};
    console.log($scope.owner, $scope.repo);

    $scope.formatDate = function(date) {
        return moment(date).format('ddd, MMM D, YYYY, h:mma UTCZZ');
    };

    function findBugNumbers(title) {
        var re = /\b[0-9]{4,10}\b/;
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

    function loadComments(owner, repo, number) {
        $http
            .get('/githubproxy/repos/' + owner + '/' + repo + '/pulls/' + number + '/comments')
            .success(function(data) {
                _.each($scope.pulls, function(pull) {
                    if (pull.number === number) {
                        pull._comments = data;
                    }
                });
            })
            .error(function(data, status) {
                console.warn(data, status);
            });

    }

    function loadPulls(owner, repo) {
        $http
        .get('/githubproxy/repos/' + owner + '/' + repo + '/pulls?state=open')
        .success(function(data, status, headers) {
            //console.dir(data);
            var pulls = [];
            var bugs = [];
            _.each(data, function(pull) {
                pull._bugs = findBugNumbers(pull.title);
                bugs = _.union(bugs, pull._bugs);
                pulls.push(pull);
                loadComments(owner, repo, pull.number);
            });
            $scope.pulls = pulls;
            console.log('ALL BUGS', bugs);
            $http
                .get('/bugzillaproxy/bug?id=' + bugs.join(',') + '&include_fields=summary,id,status,resolution,is_open')
                .success(function(data, status) {
                    console.log(data);
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
        });
    }
    loadPulls($scope.owner, $scope.repo);


})

// .controller('PullController', function($scope, $http, $routeParams) {
//     $scope.pulls = [];
//     console.log('In PullController');
//     function loadPulls(owner, repo) {
//         $http
//         .get('/proxy/repos/' + owner + '/' + repo + '/pulls?state=open')
//         .success(function(data, status, headers) {
//             console.dir(data);
//             $scope.pulls = data;
//         })
//         .error(function(data, status) {
//         });
//     }
//
//     $scope.submitForm = function() {
//         console.log(this.owner, this.repo);
//     };
//     console.dir($routeParams);
// console.log($routeParams.owner);
// console.log($routeParams.repo);
//    // console.log($location.search())
//    // console.log(($location.search()).owner);
//    // console.log(($location.search()).repo);
//
// })
//
// .controller('StartController', function($scope, $location) {
//     console.log('In StartController');
//     $scope.owner = 'mozilla';
//     $scope.repo = 'socorro';//TEMP
//     $scope.submitForm = function() {
//         $location.path('/' + this.owner + '/' + this.repo);
//     };
// })
;
