### Requeriments:

- [Node.js](https://nodejs.org/en/download/)
- [Twitter app](https://developer.twitter.com/en/docs/basics/apps/overview.html)
- [Telegram bot](https://core.telegram.org/bots)

Copy the contents of the file `example.settings.yml` to a new file `settings.yml`

Put the correct information in `settings.yml`. The fields `logFile`, `accessToken`, `accessTokenSecret`, and `user` are optional.

You can get the values for `accessToken` and `accessTokenSecret` running the script `authorize.js` like in the command below, and visiting the link to grant access to the Twitter app, then entering the PIN number to get your `accessToken` and `accessTokenSecret`:

```
$ node authorize.js
```

Run the app with the following command:

```
$ npm start
```

If you haven't authorized the app on Twitter open a private chat with the Telegram bot, and type `/start` then follow the instructions to grant authorization to the bot app on Twitter. Your `accessToken`, `accessTokenSecret`, and `user` will be saved to the file `settings.yml` automatically, and you don't have to do the authorization process again.

Once the Twitter app has been authorized anyone can start a private chat with the bot to compose a tweet to send to the authorized account like so:

1. Run `/start` to start composing a new tweet.
2. Enter the message you want to send with your tweet.
3. Upload an image or video that will be attached to the tweet (the caption will be ignored, and this step is completely optional)
4. Run `/tweet` to post your tweet to the group where an admin will approve it. Once approved it'll be automaticaly posted to the Twitter account.

If you are an admin, you'll see a post from the bot on the group that looks like this:

---

**Bot**

![](test.png)

Some message with some image that was asked by some user to be posted on Twiter

@SomeUser wants to tweet the message above, if you are an admin you can approve it by replying to this message with 👍

---

Admins can approve the tweet asking for approval just by replying with 👍, and the bot will take care of sending it to the Twitter account.

Once the tweet has been sent a message will be posted to the group that looks like this:

---

**Bot**

This tweet was requested by @SomeUser and twetted by @SomeAdmin.

Visit the link below to check it out:

https://twitter.com/TheTwitterAccount/status/1234567890-etc

![](test.png)

---
