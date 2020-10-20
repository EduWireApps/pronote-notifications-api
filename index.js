const config = require('./config.json')
const fetch = require('node-fetch')

// Start express server
const morgan = require('morgan')
const express = require('express')
const app = express()
app.use(express.json())
app.use(morgan('dev'))
app.listen(config.port, () => console.log(`Pronote Notifications API server listening on port ::${config.port}::`))

const DatabaseService = require('./services/database')
const PronoteService = require('./services/pronote')
const FirebaseService = require('./services/firebase')

const database = new DatabaseService()
const pronote = new PronoteService()
const firebase = new FirebaseService()

const synchronize = () => {
    database.users.forEach((userAuth) => {
        const oldCache = database.usersCaches.find((cache) => {
            return cache.pronoteUsername === userAuth.pronoteUsername && cache.pronoteURL === userAuth.pronoteURL
        })
        pronote.checkSession(userAuth, oldCache).then(([notifications, newCache]) => {
            if (notifications.length > 0) {
                const tokens = database.usersTokens.find((token) => {
                    return token.pronoteUsername === userAuth.pronoteUsername && token.pronoteURL === userAuth.pronoteUsername && token.isActive
                })
                const homeworksTokens = tokens.filter((token) => token.notificationsHomeworks).map((token) => token.fcmToken)
                const marksTokens = tokens.filter((token) => token.notificationsMarks).map((token) => token.fcmToken)
                notifications.forEach((notificationData) => {
                    const notification = firebase.buildNotification(notificationData)
                    if (notification.type === 'homework') {
                        firebase.sendNotification(notification, homeworksTokens)
                    } else if (notification.type === 'mark') {
                        firebase.sendNotification(notification, marksTokens)
                    }
                })
            }
            database.updateUserCache(userAuth, newCache)
        })
    })
}

const initDB = Promise.all([database.fetchUsers(), database.fetchCache(), database.fetchTokens()])
initDB.then(() => synchronize())
setInterval(() => {
    synchronize()
}, 15 * 60 * 60 * 1000)

app.post('/login', async (req, res) => {
    await initDB

    const body = req.body
    const userAuth = {
        pronoteUsername: body.pronote_username,
        pronotePassword: body.pronote_password,
        pronoteURL: body.pronote_url,
        fcmToken: body.fcm_token
    }

    const existingUser = database.users.find((user) => {
        return user.pronoteUsername === userAuth.pronoteUsername && user.pronotePassword === userAuth.pronotePassword
    })

    if (!existingUser) {
        return res.status(403).send({
            success: false,
            code: 3,
            message: 'Votre compte est introuvable.'
        })
    } else {
        return res.status(200).send({
            success: true,
            avatar_base64: existingUser.avatarBase64,
            full_name: existingUser.fullName,
            student_class: existingUser.studentClass
        })
    }
})

app.post('/register', async (req, res) => {
    await initDB

    const body = req.body
    const userAuth = {
        pronoteUsername: body.pronote_username,
        pronotePassword: body.pronote_password,
        pronoteURL: body.pronote_url,
        FCMToken: body.fcm_token
    }

    // sera remplacé par un resolveCas
    const cas = 'ac-toulouse'
    userAuth.pronoteCAS = cas

    if (Object.values(userAuth).some((v) => v === undefined)) {
        return res.status(400).send({
            success: false,
            message: 'BAD REQUEST. Essayez de mettre à jour l\'application et réessayez !'
        })
    }

    const isValidToken = await firebase.verifyToken(userAuth.FCMToken)
    if (!isValidToken) {
        return res.status(403).send({
            success: false,
            message: 'Impossible de valider le token FCM.'
        })
    }

    const existingUser = database.users.find((user) => {
        return user.pronoteUsername === userAuth.pronoteUsername && user.pronoteURL === userAuth.pronoteURL
    })

    pronote.createSession(userAuth).then((session) => {
        if (existingUser) {
            if (existingUser.pronotePassword !== userAuth.pronotePassword) {
                database.updateUserPassword({
                    pronoteUsername: userAuth.pronoteUsername,
                    pronoteURL: userAuth.pronoteURL,
                    newPassword: userAuth.pronotePassword
                })
            }
            res.status(200).send({
                success: true,
                avatarBase64: existingUser.avatarBase64,
                fullName: existingUser.fullName,
                studentClass: existingUser.studentClass
            })
        } else {
            fetch(session.user.avatar).then((result) => {
                result.buffer().then((buffer) => {
                    const imageBuffer = Buffer.from(buffer).toString('base64')
                    res.status(200).send({
                        success: true,
                        avatarBase64: imageBuffer,
                        fullName: session.user.name,
                        studentClass: session.user.studentClass.name
                    })
                    database.createUser({
                        ...userAuth,
                        ...{
                            avatarBase64: imageBuffer,
                            fullName: session.user.name,
                            studentClass: session.user.studentClass.name
                        }
                    })
                    database.createToken(userAuth, userAuth.FCMToken)
                    pronote.checkSession(userAuth, {}).then(([notifications, cache]) => {
                        database.updateUserCache(userAuth, cache)
                    })
                })
            })
        }
    }).catch((error) => {
        let message = 'Connexion à Pronote impossible. Veuillez vérifier vos identifiants et réessayez !'
        if (error.code === 3) message = 'Connexion à Pronote réussie mais vos identifiants sont incorrects. Vérifiez et réessayez !'
        res.status(403).send({
            success: false,
            message
        })
    })
})
