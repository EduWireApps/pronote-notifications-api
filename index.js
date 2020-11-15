const config = require('./config.json')
const fetch = require('node-fetch')

const Sentry = require('@sentry/node')
Sentry.init({
    dsn: config.sentryDSN,
    tracesSampleRate: 1.0
})

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
const jwt = require('./services/jwt')

const database = new DatabaseService()
const pronote = new PronoteService()
const firebase = new FirebaseService()

const synchronize = () => {
    database.users.filter((user) => !user.passwordInvalidated).forEach((userAuth) => {
        const oldCache = database.usersCaches.find((cache) => {
            return cache.pronoteUsername === userAuth.pronoteUsername && cache.pronoteURL === userAuth.pronoteURL
        })
        pronote.checkSession(userAuth, oldCache).then(([notifications, newCache]) => {
            if (notifications.length > 0) {
                const tokens = database.usersTokens.filter((token) => {
                    return token.pronoteUsername === userAuth.pronoteUsername && token.pronoteURL === userAuth.pronoteURL && token.isActive
                })
                const homeworksTokens = tokens.filter((token) => token.notificationsHomeworks).map((token) => token.fcmToken)
                const marksTokens = tokens.filter((token) => token.notificationsMarks).map((token) => token.fcmToken)
                notifications.forEach((notificationData) => {
                    database.createNotification(userAuth, notificationData).then((notificationDataDB) => {
                        const notification = {
                            title: notificationData.title,
                            body: notificationData.body
                        }
                        const sentAt = new Date()
                        if (notificationData.type === 'homework' && homeworksTokens.length > 0) {
                            firebase.sendNotification(notification, 'homework', homeworksTokens).then((responses) => {
                                database.markNotificationSent(notificationDataDB.id, new Date())
                                responses.forEach((res, i) => {
                                    const token = marksTokens[i]
                                    database.markLastActiveAt(token, sentAt)
                                    if (res.success) database.markLastSuccessAt(token, sentAt)
                                })
                            })
                        } else if (notificationData.type === 'mark' && marksTokens.length > 0) {
                            firebase.sendNotification(notification, 'mark', marksTokens).then((responses) => {
                                database.markNotificationSent(notificationDataDB.id, new Date())
                                responses.forEach((res, i) => {
                                    const token = marksTokens[i]
                                    database.markLastActiveAt(token, sentAt)
                                    if (res.success) database.markLastSuccessAt(token, sentAt)
                                })
                            })
                        }
                    })
                })
            }
            database.updateUserCache(userAuth, newCache)
        }).catch((e) => {
            if (e.message === 'Wrong user credentials') {
                database.invalidateUserPassword(userAuth)
            }
        })
    })
}

const checkInvalidated = () => {
    const usersInvalidated = database.users.filter((u) => u.passwordInvalidated)
    const failed = []
    usersInvalidated.forEach((user) => {
        if (failed.filter((e) => e === user.pronoteURL).length < 1) {
            pronote.createSession(user).then(() => {
                database.invalidateUserPassword(user, false)
            }).catch(() => {
                failed.push(user.pronoteURL)
            })
        }
    })
}

const initDB = Promise.all([database.fetchUsers(), database.fetchCache(), database.fetchTokens(), database.fetchNotifications()])
initDB.then(() => {
    if (process.argv.includes('--sync')) synchronize()
    if (process.argv.includes('--checkinv')) checkInvalidated()
})
setInterval(function () {
    synchronize()
}, 30 * 60 * 1000)
setInterval(() => {
    checkInvalidated()
}, 24 * 60 * 60 * 1000)

app.post('/logout', async (req, res) => {
    await initDB

    const token = req.headers.authorization
    const payload = jwt.verifyToken(token)
    if (!token || !payload) {
        return res.status(403).send({
            success: false,
            code: 2,
            message: 'Unauthorized'
        })
    }

    const existingToken = database.usersTokens.find((userToken) => userToken.fcmToken === payload.fcmToken)
    if (!existingToken) {
        return res.status(500).send({
            success: false,
            code: 4,
            message: 'Unknown FCM token'
        })
    }

    database.updateToken(payload.fcmToken, {
        isActive: false
    })
    return res.status(200).send({
        success: true
    })
})

app.post('/settings', async (req, res) => {
    await initDB

    const token = req.headers.authorization
    const payload = jwt.verifyToken(token)
    if (!token || !payload) {
        return res.status(403).send({
            success: false,
            code: 2,
            message: 'Unauthorized'
        })
    }
    const data = req.body

    const existingToken = database.usersTokens.find((userToken) => userToken.fcmToken === payload.fcmToken)
    if (!existingToken) {
        return res.status(500).send({
            success: false,
            code: 4,
            message: 'Unknown FCM token'
        })
    }

    database.updateToken(payload.fcmToken, {
        notificationsHomeworks: data.notifications_homeworks === 'true',
        notificationsMarks: data.notifications_marks === 'true'
    })
    return res.status(200).send({
        success: true
    })
})

app.get('/notifications', async (req, res) => {
    await initDB

    const token = req.headers.authorization
    const payload = jwt.verifyToken(token)
    if (!token || !payload) {
        return res.status(403).send({
            success: false,
            code: 2,
            message: 'Unauthorized'
        })
    }

    const existingUser = database.users.find((user) => {
        return user.pronoteUsername === payload.pronoteUsername && user.pronotePassword === payload.pronotePassword
    })

    if (!existingUser) {
        return res.status(403).send({
            success: false,
            code: 3,
            message: 'Votre compte est introuvable.'
        })
    }

    const notifications = database.notifications
        .filter((n) => n.pronoteUsername === existingUser.pronoteUsername && n.pronoteURL === existingUser.pronoteURL)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    return res.status(200).send({
        success: true,
        notifications
    })
})

app.get('/login', async (req, res) => {
    await initDB

    const token = req.headers.authorization
    const payload = jwt.verifyToken(token)
    if (!token || !payload) {
        return res.status(403).send({
            success: false,
            code: 2,
            message: 'Unauthorized'
        })
    }

    const existingUser = database.users.find((user) => {
        return user.pronoteUsername === payload.pronoteUsername && user.pronotePassword === payload.pronotePassword
    })

    if (!existingUser) {
        return res.status(403).send({
            success: false,
            code: 3,
            message: 'Votre compte est introuvable.'
        })
    } else {
        const existingToken = database.usersTokens.find((userToken) => userToken.fcmToken === payload.fcmToken)
        if (!existingToken) {
            return res.status(500).send({
                success: false,
                code: 4,
                message: 'Unknown FCM token'
            })
        }

        return res.status(200).send({
            success: true,
            avatar_base64: existingUser.avatarBase64,
            full_name: existingUser.fullName,
            student_class: existingUser.studentClass,
            establishment: existingUser.establishment,
            notifications_homeworks: existingToken.notificationsHomeworks,
            notifications_marks: existingToken.notificationsMarks
        })
    }
})

app.post('/register', async (req, res) => {
    await initDB

    const body = req.body
    const userAuth = {
        pronoteUsername: body.pronote_username,
        pronotePassword: body.pronote_password,
        pronoteURL: pronote.parsePronoteURL(body.pronote_url),
        fcmToken: body.fcm_token
    }

    if (Object.values(userAuth).some((v) => v === undefined)) {
        return res.status(400).send({
            success: false,
            message: 'BAD REQUEST. Essayez de mettre à jour l\'application et réessayez !'
        })
    }

    const token = jwt.createToken(userAuth)

    const isValidToken = await firebase.verifyToken(userAuth.fcmToken)
    if (!isValidToken) {
        return res.status(403).send({
            success: false,
            message: 'Impossible de valider le token FCM.'
        })
    }

    const existingUser = database.users.find((user) => {
        return user.pronoteUsername === userAuth.pronoteUsername && user.pronoteURL === userAuth.pronoteURL
    })

    let { cas, session } = await pronote.resolveCas(userAuth)
    userAuth.pronoteCAS = cas

    if (!session) {
        session = await pronote.createSession(userAuth).catch((error) => {
            let message = 'Connexion à Pronote impossible. Votre URL Pronote est peut-être invalide. Fermer la pop-up et cliquez sur "Q\'est-ce que "URL Pronote" pour plus d\'informations ou rejoignez notre serveur Discord : https://discord.gg/TwUUMqD pour plus d\'aide.'
            if (error.code === 3) message = 'Connexion à Pronote réussie mais vos identifiants sont incorrects. Vérifiez et réessayez !'
            if (error.code === 2) message = 'Le serveur de Notifications pour Pronote est actuellement indisponible. Réessayez dans quelques minutes !'
            res.status(403).send({
                success: false,
                message
            })
            return null
        })
    }

    if (!session) return

    if (existingUser) {
        if (existingUser.pronotePassword !== userAuth.pronotePassword) {
            database.updateUserPassword({
                pronoteUsername: userAuth.pronoteUsername,
                pronoteURL: userAuth.pronoteURL,
                newPassword: userAuth.pronotePassword
            })
        }
        database.invalidateUserPassword(userAuth, false)
        res.status(200).send({
            success: true,
            avatar_base64: existingUser.avatarBase64,
            full_name: existingUser.fullName,
            student_class: existingUser.studentClass,
            establishment: existingUser.establishment,
            notifications_homeworks: true,
            notifications_marks: true,
            jwt: token
        })
    } else {
        fetch(session.user.avatar).then((result) => {
            result.buffer().then((buffer) => {
                const imageBuffer = Buffer.from(buffer).toString('base64')
                res.status(200).send({
                    success: true,
                    avatar_base64: imageBuffer,
                    full_name: session.user.name,
                    student_class: session.user.studentClass.name,
                    establishment: session.user.establishment.name,
                    notifications_homeworks: true,
                    notifications_marks: true,
                    jwt: token
                })
                database.createUser({
                    ...userAuth,
                    ...{
                        avatarBase64: imageBuffer,
                        fullName: session.user.name,
                        studentClass: session.user.studentClass.name,
                        establishment: session.user.establishment.name
                    }
                })
                pronote.checkSession(userAuth, {}).then(([notifications, cache]) => {
                    database.updateUserCache(userAuth, cache)
                })
            })
        })
    }
    database.createOrUpdateToken(userAuth, userAuth.fcmToken)
})

app.get('*', (req, res) => res.send({
    success: true, message: 'Welcome to Notifications pour Pronote API'
}))
