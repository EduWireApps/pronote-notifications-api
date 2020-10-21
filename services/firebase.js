const GCM = require('node-gcm')
const fetch = require('node-fetch')
const config = require('../config.json')

class FirebaseService {
    constructor () {
        this.serverKey = config.googleCloudMessagingServerKey
        this.sender = new GCM.Sender(this.serverKey)
    }

    verifyToken (token) {
        return new Promise((resolve) => {
            fetch('https://fcm.googleapis.com/fcm/send', {
                method: 'POST',
                headers: {
                    Authorization: `key=${this.serverKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    registration_ids: [token]
                })
            }).then((res) => {
                res.json().then((data) => {
                    resolve(!(data.results[0].error === 'InvalidRegistration'))
                })
            })
        })
    }

    buildNotification () {
        return new GCM.Message({
            collapseKey: 'demo',
            priority: 'high',
            contentAvailable: true,
            delayWhileIdle: true,
            timeToLive: 3,
            restrictedPackageName: 'com.androz2091.pronotenotifications',
            dryRun: false,
            data: {
                key1: 'message1',
                key2: 'message2'
            },
            notification: {
                title: 'Hello, World',
                icon: 'ic_launcher',
                body: 'This is a notification that will be displayed if your app is in the background.'
            }
        })
    }

    sendNotification (message, tokens) {
        console.log(message, tokens)
        this.sender.send(message, {
            registrationTokens: tokens
        }, (error, response) => {
            console.log(response)
            if (error) console.error(error)
            else {
            }
        })
    }
}

module.exports = FirebaseService
