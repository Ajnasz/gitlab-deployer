#!/usr/local/bin/node

function getNumericFromEnv (varName) {
	let output = process.env[varName];

	if (output) {
		return +output;
	}
	return null;
}

const https = require('https');
const url = require('url');
const path = require('path');
const querystring = require('querystring');

const fs = require('fs-extra');
const decompress = require('decompress');
const targz = require('tar.gz');
const moment = require('moment');

const HOST = process.env.HOST;
const TOKEN = process.env.TOKEN;
const DEST_DIR = process.env.DEST_DIR;
const BACKUP_DIR = process.env.BACKUP_DIR;
const COMMIT_SHA = process.env.CI_BUILD_REF;

const PROJECT_NAME = process.env.PROJECT_NAME;

var WORK_DIR;

const PROJECT_ID = getNumericFromEnv('CI_PROJECT_ID');

function get (reqURL) {
	console.log('get %s', reqURL);

	return new Promise((resolve, reject) => {
		let reqObj = url.parse(reqURL);

		reqObj.headers = {
			'PRIVATE-TOKEN': TOKEN
		};

		https.request(reqObj, res => {
			const statusCode = res.statusCode;

			if (statusCode < 200 || statusCode > 299) {
				res.resume();
				return reject(new Error(`Request failed: status code ${statusCode}`));
			}

			res.setEncoding('utf8');

			let rawData = '';

			res.on('data', d => rawData += d);
			res.on('end', () => resolve(JSON.parse(rawData)));
		}).on('error', e => reject(e)).end();

	});
}

function createTmpDir () {
	return new Promise((resolve, reject) => {
		fs.mkdtemp(path.join('/tmp', 'hpbuild.'), (err, folder) => {
			if (err) {
				return reject(err);
			}

			WORK_DIR = folder;

			resolve(folder);
		});
	});
}

function getProjectID () {
	if (PROJECT_ID) {
		return Promise.resolve(PROJECT_ID);
	}

	if (!PROJECT_NAME) {
		throw new Error('Can not figure out project ID withot project name');
	}

	return get(`https://${HOST}/api/v3/projects/owned?search=${PROJECT_NAME}`).then(x => x[0].id);
}

function getProjectBuilds (projectID) {
	console.log('get project builds');
	return get(`https://${HOST}/api/v3/projects/${projectID}/builds`);
}

function getNewestBuild (builds) {
	return builds[builds.length - 1];
}

function filterDeployBuilds (builds) {
	return builds.filter(b => b.stage === 'build');
}

function filterSuccessBuilds (builds) {
	return builds.filter(b => b.status === 'success');
}

function sortBuilds (builds) {
	builds.sort((a, b) => {
		let aD = new Date(a.finished_at),
			bD = new Date(b.finished_at);

		if (aD > bD) {
			return 1;
		}
		if (aD < bD) {
			return -1;
		}

		return 0;
	});

	return builds;
}

function downloadArtifact (projectID, buildID, fn) {
	console.log('download artifact');
	let fileStream = fs.createWriteStream(path.join(WORK_DIR, fn));

	return new Promise((resolve, reject) => {
		let reqObj = url.parse(`https://${HOST}/api/v3/projects/${projectID}/builds/${buildID}/artifacts`);

		reqObj.headers = {
			'PRIVATE-TOKEN': TOKEN
		};

		https.request(reqObj, res => {
			const statusCode = res.statusCode;

			if (statusCode < 200 || statusCode > 299) {
				res.resume();
				return reject(new Error(`Request failed: status code ${statusCode}`));
			}

			res.pipe(fileStream);

			res.on('end', () => resolve(fn));
		}).on('error', e => reject(e)).end();

	});
}

function decompressArtifact (fn) {
	console.log('decompress artifact');
	return decompress(path.join(WORK_DIR, fn), path.join(WORK_DIR, 'dist')).then(() => fn);
}

function moveFile (from, to) {
	return new Promise((resolve, reject) => {
		fs.move(from, to, (err) => {
			if (err) {
				return reject(err);
			}

			resolve(from);
		});
	});
}

function moveFiles (fromDir, toDir) {
	console.log('move files', fromDir, toDir);
	return new Promise((resolve, reject) => {
		fs.readdir(fromDir, (err, files) => {
			Promise.all(files.map(file => {
				return moveFile(path.join(fromDir, file), path.join(toDir, file));
			})).then(resolve).catch(reject);
		});
	});
}

function backupOldFiles (dir, backupFile) {
	console.log('backup old files');
	return new Promise((resolve, reject) => {
		let read = targz().createReadStream(dir);
		let write = fs.createWriteStream(backupFile);

		read.pipe(write);

		read.on('error', reject);
		read.on('end', resolve);
	});
}

function removeFile (file) {
	return new Promise((resolve, reject) => {
		fs.remove(file, err => {
			if (err) {
				return reject(err);
			}

			resolve();
		});
	});
}

function removeOldFiles (dir) {
	console.log('remove old files');
	return new Promise((resolve, reject) => {
		fs.readdir(dir, (err, files) => {
			Promise.all(files.map(file => removeFile(path.join(dir, file)))).then(resolve).catch(reject);
		});
	});
}

function removeWorkDir () {
	console.log('remove work dir');
	return removeFile(WORK_DIR);
}

function getCommitBuilds (projectID, commitSHA) {
	const queryParams = querystring.stringify({
		scope: ['success']
	});
	return get(`https://${HOST}/api/v3/projects/${projectID}/repository/commits/${commitSHA}/builds?${queryParams}`);
}

function getBuildData (projectID, commitSHA) {
	console.log('get build data for project %d, and commit %s', projectID, commitSHA);

	let promise;

	if (!commitSHA) {
		promise = getProjectBuilds(projectID).then(filterSuccessBuilds);
	} else {
		promise = getCommitBuilds(projectID, commitSHA);
	}

	return promise
			.then(filterDeployBuilds)
			.then(sortBuilds)
			.then(getNewestBuild);
}

function doTheJob (projectID) {
	return getBuildData(projectID, COMMIT_SHA)
		.then(build => downloadArtifact(projectID, build.id, build.artifacts_file.filename))
		.then(decompressArtifact)
		.then(() => backupOldFiles(DEST_DIR, path.join(BACKUP_DIR, moment().format('YYYY-MM-DD_HH-mm') + '.tar.gz')))
		.then(() => removeOldFiles(DEST_DIR))
		.then(() => moveFiles(path.join(WORK_DIR, 'dist', 'dest'), DEST_DIR))
		.then(removeWorkDir);
}

function main () {
	createTmpDir()
		.then(getProjectID)
		.then(doTheJob)
		.then(x => x && console.log(x))
		.catch(e => {
			console.error(e);
			process.exit(1);
		});
}

main();
