'use strict';

var gulp = require('gulp'),
	gutil = require('gulp-util'),
	jshint = require('gulp-jshint'),
	stylish = require('jshint-stylish');

var targets = ['bin/stack-deployer.js', 'lib/stack-deployer.js'];

gulp.task('lint', function () {
	gulp.src(targets)
		.pipe(jshint())
		.pipe(jshint.reporter(stylish));
});

gulp.task('default', ['lint']);

gulp.task('watch', ['default'], function () {
	gulp.watch(targets, function (e) {
		gulp.start('default');
	});
});
