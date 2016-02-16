var url = require('url');
var config = require('config');
var sync = require('async');
var request = require('request');

var express = require('express');
var bodyParser = require('body-parser');
var app = express();

var mongo = require('mongodb');
var monk = require('monk');
var mongoUri = process.env.MONGOLAB_URI || 'mongodb://localhost:27017/slackpress';
var db = monk(mongoUri);


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
			var headers = github.getAPIHeaders(accessToken,config.get('app.name'));
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
			var users = req.db.get('users');
			var github = {
				id: githubUser.id,
				username: githubUser.login,
				url: githubUser.html_url,
				access_token: accessToken,
				avatar_url: githubUser.avatar_url
			}
			
			users.findAndModify({
				'github.id': githubUser.id
			},{
				$setOnInsert:{
					email: githubUser.email,
					created_at: new Date()
				},
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
			errorHandler.error(req,res,next,err);
		}else{
			req.session.user = user;
			var next = req.session.next;
			delete req.session.next;
			if(!next){
				next = '/';
			}
			res.redirect(next);
		}
	});

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
