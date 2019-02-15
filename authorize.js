const querystring = require('querystring');
const oauth = require('oauth');

const CONSUMER_KEY = 'IT6u2KEtKZIgUFo6BAfh1mx3I';
const CONSUMER_SECRET = 'M3VUePMnXefdeHtzY9dIeyXj6zCdk5h4b03lcmokxOGPjfRIuY';
const REQUEST_TOKEN_URL = 'https://api.twitter.com/oauth/request_token';
const ACCESS_TOKEN_URL = 'https://api.twitter.com/oauth/access_token';
const AUTHORIZE_URL = 'https://api.twitter.com/oauth/authorize';

const oa = new oauth.OAuth(REQUEST_TOKEN_URL, ACCESS_TOKEN_URL, CONSUMER_KEY, CONSUMER_SECRET, '1.0', null, 'HMAC-SHA1', null);

oa.getOAuthRequestToken(function(error, oauth_token, oauth_token_secret, oauth_authorize_url, params) {
	if (error) {
		console.log(error);
	} else {
		var url = AUTHORIZE_URL + '?' + querystring.stringify({
			oauth_token: oauth_token
		});
		console.log('Authorize this app at ' + url + ' and enter the PIN#');
		var stdin = process.openStdin();
		stdin.setEncoding('utf8');
		var pin = '';
		stdin.on('data', function(chunk) {
			pin += chunk;
		});
		stdin.on('end', function() {
			var oauth_verifier = pin.replace(/(\n|\r)+$/, '');
			oa.getOAuthAccessToken(oauth_token, oauth_token_secret, oauth_verifier, function(error, oauth_access_token, oauth_access_token_secret) {
				if (error) {
					console.log(error);
				} else {
					console.log('Access token:' + oauth_access_token);
					console.log('Access token secret:' + oauth_access_token_secret);
				}
			})
		});
	}
});
