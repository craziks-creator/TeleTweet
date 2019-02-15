process.env["NTBA_FIX_319"] = 1; // https://github.com/yagop/node-telegram-bot-api/issues/540

const Twitter = require("twit");
const TelegramBot = require("node-telegram-bot-api");
const yaml = require("js-yaml");
const winston = require("winston");
const fs = require("fs");
const request = require("request");

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

// connect to twitter
const twitterBot = new Twitter({
	consumer_key: settings.twitter.consumerKey,
	consumer_secret: settings.twitter.consumerSecret,
	access_token: settings.twitter.accessToken,
	access_token_secret: settings.twitter.accessTokenSecret
});

const twitterStream = twitterBot.stream("statuses/filter", {
	track: ["@" + settings.twitter.username]
});

// telegram bot
const activeChats = {};

telegramBot.on('message', msg => {
	if (msg.chat.type != "private") {
		return;
	}
	const re = /(\/(start|tweet|help) ?|(.+))/;
	if (msg.text) {
		const match = msg.text.match(re);
		const command = match[2];
		const message = match[3];
		switch(command) {
			case "start":
				telegramBot.sendMessage(msg.chat.id, "Type the message you want to tweet");
				activeChats[msg.chat.id] = {};
				activeChats[msg.chat.id].message = "";
				activeChats[msg.chat.id].media_ids = [];
				break;
			case "tweet":
				if (!activeChats[msg.chat.id] || !activeChats[msg.chat.id].message) {
					telegramBot.sendMessage(msg.chat.id, "Type /help to see how to use this bot.");
				} else {
					const params = { status: activeChats[msg.chat.id].message, media_ids: activeChats[msg.chat.id].media_ids };
					twitterBot.post('statuses/update', params, (error, data, response) => {
						if (!error) {
							const statusUrl = `https://twitter.com/${data.screen_name}/status/${data.id_str}`;
							telegramBot.sendMessage(msg.chat.id, `Your message was posted to your Twitter stream.\nVisit this link to check it out:\n${statusUrl}`);
							delete activeChats[msg.chat.id];
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
		const altText = msg.caption;
		let fileId;
		if (msg.photo) {
			fileId = msg.photo[msg.photo.length - 1].file_id;
		} else {
			fileId = msg.animation.file_id;
		}
		telegramBot.sendMessage(msg.chat.id, "Please wait a few seconds while the file is being uploaded to Twitter...");
		uploadMedia(twitterBot, altText, fileId, mediaId => {
			activeChats[msg.chat.id].media_ids.push(mediaId);
			telegramBot.sendMessage(msg.chat.id, "Your media file was uploaded, type /tweet to post your message to your Tweeter stream.");
		});
	}
	console.log(activeChats[msg.chat.id]);
});

telegramBot.on("error", error => {
	logger.error(error);
});

// twitter bot
twitterStream.on("tweet", tweet => {
	fromId = tweet.user.id_str;
	from = tweet.user.screen_name;
	from = from.toLowerCase();
	if (from == settings.twitter.username.toLowerCase()) {
		return;
	}
	let fullTweet;
	if (tweet.extended_tweet && tweet.extended_tweet.full_text) {
		fullTweet = tweet.extended_tweet.full_text;
	} else {
		fullTweet = tweet.text;
	}
	telegramBot.sendMessage(settings.telegram.chatId, `@${from} tweeted: ${fullTweet}`);
});

twitterStream.on("error", error => {
	console.log(error);
	logger.error(error);
});

twitterStream.on("connect", request => {
	logger.info("Connecting TipBot to Twitter.....");
});

twitterStream.on("connected", response => {
	logger.info("Connected TipBot to Twitter.");
});

twitterStream.on("disconnect", disconnectMessage => {
	logger.error("Disconnected TipBot from Twitter.\n" + disconnectMessage);
	logger.info("Trying to reconnect.....");
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
