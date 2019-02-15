process.env["NTBA_FIX_319"] = 1; // https://github.com/yagop/node-telegram-bot-api/issues/540

const Twitter = require("twit");
const TelegramBot = require("node-telegram-bot-api");
const yaml = require("js-yaml");
const winston = require("winston");
const fs = require("fs");
const request = require("request");
const querystring = require('querystring');
const oauth = require('oauth');

const REQUEST_TOKEN_URL = 'https://api.twitter.com/oauth/request_token';
const ACCESS_TOKEN_URL = 'https://api.twitter.com/oauth/access_token';
const AUTHORIZE_URL = 'https://api.twitter.com/oauth/authorize';

// setup logger
const logger = winston.createLogger();
logger.add(new winston.transports.Console());

// check if the settings file exists
if (!fs.existsSync("./settings.yml")) {
	logger.error(
		"Configuration file doesn't exist! Please read the README.md file first."
	);
	process.exit(1);
}

// load settings
const settings = yaml.load(fs.readFileSync("./settings.yml", "utf-8"));

if (settings.log.file) {
	// write logger to file
	logger.add(new winston.transports.File({ filename: settings.log.file }));
}
if (settings.log.level) {
	// use logger level from settings file
	logger.level = settings.log.level;
}

// connect to telegram
const telegramBot = new TelegramBot(settings.telegram.token, { polling: true });

// telegram bot
const activeChats = {};

console.log("Running...");

telegramBot.on('message', msg => {
	if (msg.chat.type != "private") {
		return;
	}
	if (!activeChats[msg.chat.id]) {
		activeChats[msg.chat.id] = {};
	}
	if (!activeChats[msg.chat.id].credentials) {
		if (!activeChats[msg.chat.id].verifier) {
			telegramBot.sendMessage(msg.chat.id, "Please first authorize the app in order to be able to tweet to your Twitter stream from this chat.");

			const oa = new oauth.OAuth(REQUEST_TOKEN_URL, ACCESS_TOKEN_URL, settings.twitter.consumerKey, settings.twitter.consumerSecret, '1.0', null, 'HMAC-SHA1', null);
			oa.getOAuthRequestToken(function(error, oauth_token, oauth_token_secret, oauth_authorize_url, params) {
				if (error) {
					console.log(error);
					telegramBot.sendMessage(msg.chat.id, "Couldn't authenticate using your app credentials...");
	
				} else {
					var url = AUTHORIZE_URL + '?' + querystring.stringify({
						oauth_token: oauth_token
					});
					telegramBot.sendMessage(msg.chat.id, `Your authorization url is\n${url}\nPlease authorize the app on the link above and paste the PIN number in the chat, then hit Enter.`);
					activeChats[msg.chat.id].verifier = (oauth_verifier, callback) => {
						oa.getOAuthAccessToken(oauth_token, oauth_token_secret, oauth_verifier, function(error, oauth_access_token, oauth_access_token_secret) {
							if (error) {
								callback(error);	
							} else {
								callback(null, { accessToken: oauth_access_token, accessTokenSecret: oauth_access_token_secret });
							}
						});	
					}
				}
			});
		} else {
			activeChats[msg.chat.id].verifier(msg.text, (error, credentials) => {
				if (!error) {
					telegramBot.sendMessage(msg.chat.id, "The app has been authorized successfully, /start tweeting or type /help to see how it's used.");
					activeChats[msg.chat.id].credentials = credentials;
				}
			});
		}
		return;
	}
	const re = /(\/(start|tweet|help) ?|(.+))/;
	if (msg.text) {
		const match = msg.text.match(re);
		const command = match[2];
		const message = match[3];
		switch(command) {
			case "start":
				activeChats[msg.chat.id].message = "";
				activeChats[msg.chat.id].media_ids = [];
				if (!activeChats[msg.chat.id].twitter_client) {

					const twitterBot = new Twitter({
						consumer_key: settings.twitter.consumerKey,
						consumer_secret: settings.twitter.consumerSecret,
						access_token: activeChats[msg.chat.id].credentials.accessToken,
						access_token_secret: activeChats[msg.chat.id].credentials.accessTokenSecret
					});

					telegramBot.sendMessage(msg.chat.id, "Verifying your Twitter credentials...");

					twitterBot.get('account/verify_credentials', { include_entities: false, skip_status: true, include_email: false }, (error, user) => {
						if (!error) {
							const twitterStream = twitterBot.stream("statuses/filter", {
								track: ["@" + user.screen_name]
							});							
					
							twitterStream.on("error", error => {
								telegramBot.sendMessage(msg.chat.id, "Something went worng when trying to connect with Twitter");
								logger.error(error);
							});
							
							twitterStream.on("connect", request => {
								telegramBot.sendMessage(msg.chat.id, "Connecting to Twitter...");
								logger.info("Connecting to Twitter...");
							});
							
							twitterStream.on("connected", response => {
								telegramBot.sendMessage(msg.chat.id, "Connected to Twitter ✔️");
								logger.info("Connected to Twitter.");
							});
							
							twitterStream.on("disconnect", disconnectMessage => {
								logger.error("Disconnected from Twitter.\n" + disconnectMessage);
								telegramBot.sendMessage(msg.chat.id, "Disconnected from Twitter");
							});
							
							activeChats[msg.chat.id].twitter_client = twitterBot;
						} else {
							console.error(error);
							telegramBot.sendMessage(msg.chat.id, "Couldn't verify your Twitter credentials...");
						}
					});
				}
				break;
			case "tweet":
				if (!activeChats[msg.chat.id].twitter_client) {
					telegramBot.sendMessage(msg.chat.id, "Not connected to Twitter try /start to connect.");
					break;
				}
				if (!activeChats[msg.chat.id].message) {
					telegramBot.sendMessage(msg.chat.id, "Type /help to see how to use this bot.");
				} else {
					const params = { status: activeChats[msg.chat.id].message, media_ids: activeChats[msg.chat.id].media_ids };
					activeChats[msg.chat.id].twitter_client.post('statuses/update', params, (error, data, response) => {
						if (!error) {
							const statusUrl = `https://twitter.com/${data.screen_name}/status/${data.id_str}`;
							telegramBot.sendMessage(msg.chat.id, `Your message was posted to your Twitter stream.\nVisit this link to check it out:\n${statusUrl}`);
							activeChats[msg.chat.id].message = "";
							activeChats[msg.chat.id].media_ids = [];
						} else {
							console.log(error);
							telegramBot.sendMessage(msg.chat.id, "Something went wrong when trying to post your message to your Twitter stream");
						}
					});	
				}
				break;
			case "help":
				telegramBot.sendMessage(msg.chat.id, "1) Type the command /start\n2) Type message you want to tweet.\n3) Upload the media files you want to post with your tweet.\n4) Type the command /tweet to post your message to your Twitter stream.");
				break;
			default:
				if (command) {
					telegramBot.sendMessage(msg.chat.id, "The list of supported commands is /start, /tweet and /help");
				} else if(message) {
					if (message.length > 280) {
						telegramBot.sendMessage(msg.chat.id, `The message surpases 280 characters by ${message.length - 280}, please type a shortened message`);
					} else {
						telegramBot.sendMessage(msg.chat.id, `Upload a media file to attach to your tweet, or type /tweet to post your message to your stream`);
						activeChats[msg.chat.id].message = message;
					}
				}
				break;
		}

	} else if (msg.photo || msg.animation) {
		if (!activeChats[msg.chat.id].twitter_client) {
			telegramBot.sendMessage(msg.chat.id, "Not connected to Twitter try /start to connect.");
		} else {
			const altText = msg.caption;
			let fileId;
			if (msg.photo) {
				fileId = msg.photo[msg.photo.length - 1].file_id;
			} else {
				fileId = msg.animation.file_id;
			}
			telegramBot.sendMessage(msg.chat.id, "Please wait a few seconds while the file is being uploaded to Twitter...");
			uploadMedia(activeChats[msg.chat.id].twitter_client, altText, fileId, mediaId => {
				activeChats[msg.chat.id].media_ids.push(mediaId);
				telegramBot.sendMessage(msg.chat.id, "Your media file was uploaded, type /tweet to post your message to your Tweeter stream.");
			});	
		}
	}
	console.log(activeChats[msg.chat.id]);
});

telegramBot.on("error", error => {
	logger.error(error);
});

function uploadMedia(twitterBot, altText, fileId, callback) {
	request(`https://api.telegram.org/bot${settings.telegram.token}/getFile?file_id=${fileId}`, (error, response, body) => {
		const filePath = JSON.parse(body).result.file_path;
		request({
			url: `https://api.telegram.org/file/bot${settings.telegram.token}/${filePath}`,
			encoding: 'binary',
			headers: {
				"Connection": "keep-alive"
			}
		}, (error, response, body) => {
			const base64 = Buffer.from(body, 'binary').toString('base64');
			twitterBot.post('media/upload', { media: base64 }, (error, data, response) => {
				const mediaId = data.media_id_string;
				twitterBot.post('media/metadata/create', { media_id: mediaId, alt_text: altText }, (error, data, response) => {
					callback(mediaId);
				});
			});	
		});
	});
}
