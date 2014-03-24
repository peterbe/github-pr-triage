angular.module('triage', [
    'ngRoute',
    'angularMoment',
    'triage.controllers'
])

.config(['$routeProvider', '$locationProvider', function ($routeProvider, $locationProvider) {
    $locationProvider.html5Mode(true);

    $routeProvider
    .when('/:owner/:repo', {
        templateUrl: "/partials/table.html",
        controller: 'PullsController'
    })
    .when('/', {
        templateUrl: "/partials/form.html",
        controller:'FormController'
    })
    ;
}])

.factory('ratelimit', function() {
    var ratelimit = {};
    var service = {};

    service.update = function(limit, remaining) {
        ratelimit.limit = limit;
        ratelimit.remaining = remaining;
    };
    service.get = function() {
        return ratelimit;
    };

    return service;
})


;
