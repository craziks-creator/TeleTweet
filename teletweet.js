process.env["NTBA_FIX_319"] = 1; // https://github.com/yagop/node-telegram-bot-api/issues/540

const Twitter = require("twit");
const TelegramBot = require("node-telegram-bot-api");
const yaml = require("js-yaml");
const winston = require("winston");
const fs = require("fs");

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
telegramBot.onText(/\/tweet (.+)/, (msg, match) => {
	var resp = match[1];

	twitterBot.post(
		"statuses/update",
		{
			status: resp
		},
		function(error, tweet, response) {
			if (error) {
				logger.error(error);
			}
		}
	);
});

/*
telegramBot.on('message', (msg) => {
	var chatId = msg.chat.id;
	telegramBot.sendMessage(chatId, 'Received your message');
});
*/

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
