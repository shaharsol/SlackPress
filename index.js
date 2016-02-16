var url = require('url');
var config = require('config');
var sync = require('async');
var request = require('request');
var util = require('util');
var async = require('async');
var _ = require('lodash');
var wordpress = require( "wordpress" );

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
				access_token: data.access_token,
				team_id: data.team_id
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
  response.render('pages/index',{
	  config: config
  });
});

app.post('/blogit', function(req, res) {
	console.log('slack response is %s',util.inspect(req.body,{depth: 8}));
	res.sendStatus(200).end();
	var users = db.get('users');
	users.findOne({'slack.team_id': req.body.team_id},function(err,user){
		if(err){
			console.log('error fethcing one user: %s',err);
		}else{

			console.log('user is: %s',util.inspect(user));

			var form = {
				token: user.slack.access_token,
				channel: req.body.channel_id
			}
			request.post('https://slack.com/api/channels.history?token=' + user.slack.access_token + '&channel=' + req.body.channel_id,function(error,response,body){
				if(error){
					console.log('error in slack oath %s',error);
				}else if(response.statusCode > 300){
					console.log('error in slack oath %s %s',response.statusCode,body);
				}else{
					console.log('channel history: %s',util.inspect(body,{depth: 8}))

					// TBD verify we got "ok: true"
					var messages = JSON.parse(body).messages;
					var post = _.chain(messages)
						.filter(function(message) {
							return !message.subtype;
						}).map(function(message){
							return '<p>' + message.text + '</p>';
						})
						.reverse()
						.value()
						.join('\n');

						console.log(post);

					var wp = wordpress.createClient({
					    url: "162.243.237.137",
					    username: "shaharsol",
					    password: "12345678"
					});	
					
					wp.newPost({
						title: 'post from slack',
						content: post
					},function(err,postID){
						if(err){
							console.log('error posting to wordpress: %s',err)
						}else{
							console.log('no error from wordpress %s',postID);
							// http://162.243.237.137/wp-admin/post.php?post=12&action=edit
							
							var postBody = {
								text: 'Edit your draft at http://162.243.237.137/wp-admin/post.php?post=' + postID + '&action=edit'	
							}
							var headers = {
								'Content-Type': 'application/json'	
							}
							
							console.log('rersponse utl is : %s',req.body.response_url);
							
							request.post(req.body.response_url,{body: JSON.stringify(postBody), headers: headers},function(error,response,body){
								if(error){
									console.log('error in slack oath %s',error);
								}else if(response.statusCode > 300){
									console.log('error in slack oath %s %s',response.statusCode,body);
								}else{
									console.log('slack delayed response response is %s',body);
								}
							})
							
							
						}
					});


					

				}
			})
		}
	})





})

app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});
console.log('env is: ' + app.get('env'));
