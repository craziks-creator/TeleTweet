process.env["NTBA_FIX_319"] = 1; // https://github.com/yagop/node-telegram-bot-api/issues/540

const Twitter = require("twit");
const TelegramBot = require("node-telegram-bot-api");
const yaml = require("js-yaml");
const fs = require("fs");
const request = require("request");
const querystring = require("querystring");
const oauth = require("oauth");
const { createLogger, format, transports } = require("winston");
const { combine, timestamp, label, printf } = format;
const path = require("path");

const REQUEST_TOKEN_URL = "https://api.twitter.com/oauth/request_token";
const ACCESS_TOKEN_URL = "https://api.twitter.com/oauth/access_token";
const AUTHORIZE_URL = "https://api.twitter.com/oauth/authorize";
const SETTINGS_FILE = "./settings.yml";
const WAITING_FOR_APPROVAL =
	"<%MESSAGE%>\n\n<%USER%> wants to tweet the message above, if you are an admin you can approve it by replying to this message with 👍";
const BEING_TWEETED =
	"<%MESSAGE%>\n\n<%USER%> wanted to tweet the message above and it's been approved by <%ADMIN%>";
const TWEETED =
	"This tweet was requested by <%USER%> and twetted by <%ADMIN%>.\nVisit the link below to check it out:\n<%LINK%>";

// check if the settings file exists
if (!fs.existsSync(SETTINGS_FILE)) {
	logger.error(
		"Configuration file doesn't exist! Please read the README.md file first."
	);
	process.exit(1);
}

// load settings
const settings = yaml.load(fs.readFileSync(SETTINGS_FILE, "utf-8"));

// create logger
const logger = createLogger({ level: "debug" });

logger.add(
	new transports.Console({
		format: combine(
			label({ label: "TeleTweet" }),
			printf(info => `[${info.level}]: ${info.label} - ${info.message}`)
		)
	})
);

if (settings.logFile) {
	logger.add(
		new transports.File({
			filename: settings.logFile,
			format: combine(
				label({ label: "TeleTweet" }),
				timestamp(),
				printf(
					info =>
						`[${info.timestamp}] [${info.level}]: ${info.label} - ${
							info.message
						}`
				)
			)
		})
	);
}

// connect to telegram
let telegramBotId;
const telegramBot = new TelegramBot(settings.telegram.token, {
	polling: true
});

// telegram bot
const usersChat = {};
let oauthVerifier;

// twitter bot
let twitterBot;

logger.debug("Running...");

telegramBot.on("message", async msg => {
	if (!settings.twitter.accessToken || !settings.twitter.accessTokenSecret) {
		if (msg.chat.type == "private") {
			authorizeTwitterApp(msg);
		}
	} else {
		if (msg.chat.type == "private") {
			if (!twitterBot) {
				createTwitterBot(msg);
			} else {
				prepareTweet(msg);
			}
		} else {
			if (twitterBot) {
				isAdmin(msg, result => {
					if (result) {
						if (!telegramBotId) {
							telegramBot.getMe().then(result => {
								telegramBotId = result.id;
								checkPreparedTweet(msg);
							});
						} else {
							checkPreparedTweet(msg);
						}
					}
				});
			}
		}
	}
});

telegramBot.on("error", error => {
	logger.error(error);
	process.exit(1);
});

function checkPreparedTweet(msg) {
	if (msg.reply_to_message && msg.reply_to_message.from.id == telegramBotId) {
		if (msg.text == "👍") {
			const rawMessage =
				msg.reply_to_message.text || msg.reply_to_message.caption;
			const escaped = WAITING_FOR_APPROVAL.replace(
				/[.*+?^${}()|[\]\\]/g,
				"\\$&"
			)
				.replace("<%USER%>", "@([a-z0-9_]+)")
				.replace("<%MESSAGE%>", "(.+)");
			const re = new RegExp(escaped);
			const match = rawMessage.match(re);
			if (match) {
				const originalMessage = match[1];
				const originalAuthor = match[2];
				let fileId = null;
				if (msg.reply_to_message.photo) {
					fileId =
						msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1]
							.file_id;
				} else if (msg.reply_to_message.animation) {
					fileId = msg.reply_to_message.animation.file_id;
				} else if (msg.reply_to_message.document) {
					fileId = msg.reply_to_message.document.file_id;
				} else if (msg.reply_to_message.video) {
					fileId = msg.reply_to_message.video.file_id;
				}
				const newMessage = BEING_TWEETED.replace("<%MESSAGE%>", originalMessage)
					.replace("<%USER%>", "@" + originalAuthor)
					.replace("<%ADMIN%>", "@" + msg.from.username);
				if (fileId) {
					telegramBot.editMessageCaption(newMessage, {
						chat_id: msg.chat.id,
						message_id: msg.reply_to_message.message_id
					});
					uploadMedia(fileId, mediaId => {
						tweet(
							msg,
							originalMessage,
							mediaId,
							originalAuthor,
							msg.from.username
						);
					});
				} else {
					telegramBot.editMessageText(newMessage, {
						chat_id: msg.chat.id,
						message_id: msg.reply_to_message.message_id
					});
					tweet(msg, originalMessage, null, originalAuthor, msg.from.username);
				}
			}
		} else {
		}
	}
}

function uploadMedia(fileId, callback) {
	request(
		`https://api.telegram.org/bot${
			settings.telegram.token
		}/getFile?file_id=${fileId}`,
		(error, response, body) => {
			if (error || response.statusCode != 200) {
				return logger.error(
					"Couldn't retrieve the telegram media file_id",
					error || response.statusMessage
				);
			}
			const filePath = JSON.parse(body).result.file_path;
			request(
				{
					url: `https://api.telegram.org/file/bot${
						settings.telegram.token
					}/${filePath}`,
					encoding: "binary",
					headers: {
						Connection: "keep-alive"
					}
				},
				(error, response, body) => {
					if (error || response.statusCode != 200) {
						return logger.error(
							"Couldn't download the telegram media file",
							error || response.statusMessage
						);
					}
					const filename = path.basename(filePath);
					fs.writeFile(filename, body, "binary", error => {
						if (error) {
							return logger.error(error);
						}
						twitterBot.postMediaChunked({ file_path: filename }, function(
							error,
							data,
							response
						) {
							if (error || response.statusCode != 200) {
								return logger.error(
									"Couldn't upload the media file",
									error || response.statusMessage
								);
							}
							fs.unlink(filename, error => {
								if (error) {
									return logger.error(error);
								}
							});
							const mediaId = data.media_id_string;
							twitterBot.post(
								"media/metadata/create",
								{ media_id: mediaId },
								(error, data, response) => {
									if (error || response.statusCode != 200) {
										return logger.error(
											"Couldn't create metadata for tweet",
											error || response.statusMessage
										);
									}
									callback(mediaId);
								}
							);
						});
					});
				}
			);
		}
	);
}

function authorizeTwitterApp(msg) {
	if (!oauthVerifier) {
		telegramBot.sendMessage(
			msg.chat.id,
			"Please first authorize the app in order to be able to tweet."
		);

		const oa = new oauth.OAuth(
			REQUEST_TOKEN_URL,
			ACCESS_TOKEN_URL,
			settings.twitter.consumerKey,
			settings.twitter.consumerSecret,
			"1.0",
			null,
			"HMAC-SHA1",
			null
		);
		oa.getOAuthRequestToken(function(
			error,
			oauth_token,
			oauth_token_secret,
			oauth_authorize_url,
			params
		) {
			if (error) {
				logger.debug(error);
				telegramBot.sendMessage(
					msg.chat.id,
					"Couldn't authenticate using your credentials."
				);
			} else {
				var url =
					AUTHORIZE_URL +
					"?" +
					querystring.stringify({
						oauth_token: oauth_token
					});
				telegramBot.sendMessage(
					msg.chat.id,
					`Your authorization url is\n${url}\nPlease authorize the app on the link above and paste the PIN number in the chat, then hit Enter.`
				);
				oauthVerifier = (pin, callback) => {
					oa.getOAuthAccessToken(
						oauth_token,
						oauth_token_secret,
						pin,
						(error, oauth_access_token, oauth_access_token_secret) => {
							if (error) {
								callback(error);
							} else {
								callback(null, {
									accessToken: oauth_access_token,
									accessTokenSecret: oauth_access_token_secret
								});
							}
						}
					);
				};
			}
		});
	} else {
		oauthVerifier(msg.text, (error, credentials) => {
			if (error) {
				return logger.error("The verification step was not completed", error);
			}
			settings.twitter.accessToken = credentials.accessToken;
			settings.twitter.accessTokenSecret = credentials.accessTokenSecret;
			fs.writeFileSync(SETTINGS_FILE, yaml.safeDump(settings));

			telegramBot.sendMessage(
				msg.chat.id,
				"The app has been authorized successfully."
			);

			createTwitterBot(msg);
		});
	}
}

function createTwitterBot(msg) {
	twitterBot = new Twitter({
		consumer_key: settings.twitter.consumerKey,
		consumer_secret: settings.twitter.consumerSecret,
		access_token: settings.twitter.accessToken,
		access_token_secret: settings.twitter.accessTokenSecret
	});

	telegramBot.sendMessage(msg.chat.id, "Verifying your Twitter credentials...");

	twitterBot.get(
		"account/verify_credentials",
		{
			include_entities: false,
			skip_status: true,
			include_email: false
		},
		(error, user) => {
			if (error) {
				logger.error(error);
				telegramBot.sendMessage(
					msg.chat.id,
					"Couldn't verify your Twitter credentials..."
				);
				return;
			}

			settings.twitter.user = user.screen_name;
			fs.writeFileSync(SETTINGS_FILE, yaml.safeDump(settings));

			const twitterStream = twitterBot.stream("statuses/filter", {
				track: ["@" + user.screen_name]
			});

			twitterStream.on("error", error => {
				logger.error(error);
			});

			twitterStream.on("connect", request => {
				console.info("Connecting to Twitter...");
			});

			twitterStream.on("connected", response => {
				telegramBot.sendMessage(
					msg.chat.id,
					`Connected to the Twitter account [@${
						user.screen_name
					}](https://twitter.com/${
						user.screen_name
					}), /start tweeting or ask for /help to see the instructions.`,
					{ parse_mode: "Markdown" }
				);
				console.info("Connected to Twitter.");
			});

			twitterStream.on("disconnect", disconnectMessage => {
				logger.error("Disconnected from Twitter.\n" + disconnectMessage);
				telegramBot.sendMessage(msg.chat.id, "Disconnected from Twitter");
			});
		}
	);
}

function prepareTweet(msg) {
	if (!usersChat[msg.from.id]) {
		usersChat[msg.from.id] = {};
	}
	const re = /(\/(start|tweet|help) ?|(.+))/;
	if (msg.text) {
		const match = msg.text.match(re);
		const command = match[2];
		const message = match[3];
		switch (command) {
			case "start":
				usersChat[msg.from.id].message = "";
				telegramBot.sendMessage(
					msg.chat.id,
					"Type any message that you want to be tweeted, the most recent message is the one used for the tweet."
				);
				break;
			case "tweet":
				if (!usersChat[msg.from.id].message) {
					telegramBot.sendMessage(
						msg.chat.id,
						"Type /help to see how to use this bot."
					);
					break;
				}
				const waitingForApproval = WAITING_FOR_APPROVAL.replace(
					"<%USER%>",
					"@" + msg.from.username
				).replace("<%MESSAGE%>", usersChat[msg.from.id].message);
				if (!usersChat[msg.from.id].file_id) {
					telegramBot.sendMessage(settings.telegram.chatId, waitingForApproval);
				} else {
					switch (usersChat[msg.from.id].file_type) {
						case "photo":
							telegramBot.sendPhoto(
								settings.telegram.chatId,
								usersChat[msg.from.id].file_id,
								{ caption: waitingForApproval }
							);
							break;
						case "document":
							telegramBot.sendDocument(
								settings.telegram.chatId,
								usersChat[msg.from.id].file_id,
								{ caption: waitingForApproval }
							);
							break;
						case "video":
							telegramBot.sendVideo(
								settings.telegram.chatId,
								usersChat[msg.from.id].file_id,
								{ caption: waitingForApproval }
							);
							break;
					}
				}
				usersChat[msg.from.id].message = null;
				usersChat[msg.from.id].file_type = null;
				usersChat[msg.from.id].file_id = null;
				break;
			case "help":
				telegramBot.sendMessage(
					msg.chat.id,
					"1) Type the message you want to tweet.\n2) Upload the media file you want to post to your tweet (optional).\n3) Type the command /tweet to post your message to the group so that an admin can authorize your tweet."
				);
				break;
			default:
				if (command) {
					telegramBot.sendMessage(
						msg.chat.id,
						"The list of supported commands is /start, /tweet and /help"
					);
				} else if (message) {
					if (message.length > 280) {
						telegramBot.sendMessage(
							msg.chat.id,
							`The message surpases 280 characters by ${message.length -
								280}, please type a shortened message`
						);
					} else {
						telegramBot.sendMessage(
							msg.chat.id,
							`Upload a media file to attach to your tweet, or type /tweet send it as is.`
						);
						usersChat[msg.from.id].message = message;
					}
				}
				break;
		}
	} else if (msg.photo || msg.animation || msg.video || msg.document) {
		usersChat[msg.from.id].file_id = null;
		if (msg.photo) {
			usersChat[msg.from.id].file_id = msg.photo[msg.photo.length - 1].file_id;
			usersChat[msg.from.id].file_type = "photo";
		} else if (msg.animation) {
			usersChat[msg.from.id].file_id = msg.animation.file_id;
			usersChat[msg.from.id].file_type = "document";
		} else if (msg.video) {
			usersChat[msg.from.id].file_id = msg.video.file_id;
			usersChat[msg.from.id].file_type = "video";
		} else if (msg.document) {
			usersChat[msg.from.id].file_id = msg.document.file_id;
			usersChat[msg.from.id].file_type = "document";
		}
		if (usersChat[msg.from.id].file_id) {
			if (usersChat[msg.from.id].message) {
				telegramBot.sendMessage(
					msg.chat.id,
					"Your media file has been attached to the tweet, type /tweet to send it."
				);
			} else {
				telegramBot.sendMessage(
					msg.chat.id,
					"Now type the message you want to send with your tweet."
				);
			}
		}
	} else {
		telegramBot.sendMessage(
			msg.chat.id,
			"I'm sorry, this type of file is not supported."
		);
	}
}

function isAdmin(msg, callback) {
	telegramBot.getChatMember(msg.chat.id, msg.from.id).then(result => {
		callback(result.status == "creator" || result.status == "administrator");
	});
}

function tweet(msg, status, mediaId, user, admin) {
	const media_ids = [];
	if (mediaId) {
		media_ids.push(mediaId);
	}
	const params = { status: status, media_ids: media_ids };
	twitterBot.post("statuses/update", params, (error, data, response) => {
		if (error || response.statusCode != 200) {
			return logger.error(
				"Couldn't post status to the Twitter stream",
				error || response.statusMessage
			);
		}
		const statusUrl = `https://twitter.com/${data.screen_name}/status/${
			data.id_str
		}`;
		const message = TWEETED.replace("<%USER%>", "@" + user)
			.replace("<%ADMIN%>", "@" + admin)
			.replace("<%LINK%>", statusUrl);
		telegramBot.sendMessage(msg.chat.id, message);
	});
}
