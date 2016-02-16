var url = require('url');
var config = require('config');
var sync = require('async');
var request = require('request');
var util = require('util');
var async = require('async');

var express = require('express');
var bodyParser = require('body-parser');
var app = express();



var mongo = require('mongodb');
var monk = require('monk');
var mongoUri = process.env.MONGOLAB_URI || 'mongodb://localhost:27017/slackpress';
var db = monk(mongoUri);

var session = require('express-session')
var MongoStore = require('connect-mongo')(session);
app.use(session({
	secret: 'MyBloody',
	resave: false,
	saveUninitialized: false,
	store: new MongoStore({
		url: mongoUri,
		autoReconnect: true
	})
}));


app.set('port', (process.env.PORT || 5000));

app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ extended: false }))

// views is directory for all template files
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.get('/connect-github', function(req, res, next) {
	var redirect = {
		protocol: 'https',
		host: 'github.com',
		pathname: '/login/oauth/authorize',
		query: {
			client_id: config.get('github.client_id'),
			redirect_uri: 'http://' + config.get('github.redirect_domain') + '/connected-github',
			scope: 'repo'
		}
	}
	res.redirect(url.format(redirect));
});

app.get('/connected-github', function(req, res, next) {
	
	async.waterfall([
	    // switch the code for access token             
		function(callback){
			var form = {
				client_id: config.get('github.client_id'),
				client_secret: config.get('github.client_secret'),
				code: req.query.code,
			}
			var headers = {
				Accept: 'application/json'
			}
			request.post('https://github.com/login/oauth/access_token',{form: form, headers: headers},function(error,response,body){
				if(error){
					callback(error);
				}else if(response.statusCode > 300){
					callback(response.statusCode + ' : ' + body);
				}else{
					var data = JSON.parse(body);
					var accessToken = data.access_token;
					callback(null,accessToken);
				}
			});
		},
		// get the github user record
		function(accessToken,callback){
			var headers = {
				Authorization: 'token ' + accessToken,
				Accept: 'application/vnd.github.v3+json',
				'User-Agent': 'SlackPress'
			}
			request('https://api.github.com/user',{headers: headers},function(error,response,body){
				if(error){
					callback(error);
				}else if(response.statusCode > 300){
					callback(response.statusCode + ' : ' + body);
				}else{
					callback(null,accessToken,JSON.parse(body));
				}
			});
		},
		// insert/update the user record to db
		function(accessToken,githubUser,callback){
			var users = db.get('users');
			var github = {
				id: githubUser.id,
				username: githubUser.login,
				url: githubUser.html_url,
				access_token: accessToken,
				avatar_url: githubUser.avatar_url
			}
			
			users.findAndModify({
				'_id': req.session.user._id.toString()
			},{
				$set: {
					github: github, 
				}
			},{
				upsert: true,
				new: true
			},function(err,user){
				callback(err,user)
			});
		}
	],function(err,user,avatar){
		if(err){
//			errorHandler.error(req,res,next,err);
		}else{
			req.session.user = user;
			res.redirect('/thank-you');
		}
	});

});

app.get('/thank-you',function(req,res){
	res.render('pages/thank-you',{
		username: req.session.user.github.username
	});
})	

app.get('/slack-authorized', function(req, res) {
	console.log('code is %s',req.query.code);
	var form = {
		client_id: config.get('slack.client_id'),
		client_secret: config.get('slack.client_secret'),
		code: req.query.code,
	}
	request.post('https://slack.com/api/oauth.access',{form: form},function(error,response,body){
		if(error){
			console.log('error in slack oath %s',error);
		}else if(response.statusCode > 300){
			console.log('error in slack oath %s %s',response.statusCode,body);
		}else{
			console.log('slack response is %s',body);
			var data = JSON.parse(body);
			var users = db.get('users');
			var slack = {
				access_token: data.access_token
			}
//			console.log('current user is %s',util.inspect(req.session.user));
			users.insert({slack: slack},function(err,user){
				if(err){
					console.log('error inserting user %s',err);
				}else{
					req.session.user = user;
					res.redirect('/connect-github');
				}
				
			});
		}
	})
});


app.get('/', function(request, response) {
  response.render('pages/index');
});

app.post('/blogit', function(request, response) {
  response.send(request.body);
})

app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});
