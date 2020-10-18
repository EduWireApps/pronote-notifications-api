const GCM = require('node-gcm')
const config = require('../config.json')

class FirebaseService {
    constructor () {
        this.sender = new GCM.Sender(config.googleCloudMessagingServerKey)
    }

    buildNotification () {
        return new GCM.Message({
            collapseKey: 'demo',
            priority: 'high',
            contentAvailable: true,
            delayWhileIdle: true,
            timeToLive: 3,
            restrictedPackageName: 'com.androz2091.pronotenotifications',
            dryRun: true,
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
        this.sender.send(message, {
            registrationTokens: tokens
        }, (error, response) => {
            console.log(response)
            if (error) console.error(error)
            else {
                const failedTokens = tokens.filter((token, i) => response[i].error != null)
                console.log(failedTokens)
            }
        })
    }
}

module.exports = FirebaseService
