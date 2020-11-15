const config = require('../config.json')
const { Pool } = require('pg')

const quoteEscape = (value) => value.replace(/'/g, "''")

class DatabaseService {
    constructor () {
        this.pool = new Pool(config.database)
            .on('connect', () => {
                console.log('Connected to PostgreSQL database')
            })
            .on('error', (e) => console.error(e))
        this.users = []
        this.usersCaches = []
        this.usersTokens = []
        this.notifications = []
    }

    query (query) {
        return new Promise((resolve) => {
            this.pool.query(query, (error, results) => {
                if (!error) resolve(results.rows)
                else console.error(error)
            })
        })
    }

    fetchUsers () {
        return new Promise((resolve) => {
            this.query(`
                SELECT * FROM users
            `).then((rows) => {
                this.users = rows.map((row) => {
                    return {
                        pronoteURL: row.pronote_url,
                        pronoteUsername: row.pronote_username,
                        pronotePassword: row.pronote_password,
                        pronoteCAS: row.pronote_cas,
                        avatarBase64: row.avatar_base64,
                        fullName: row.full_name,
                        studentClass: row.student_class,
                        establishment: row.establishment,
                        passwordInvalidated: row.password_invalidated
                    }
                })
                resolve()
            })
        })
    }

    fetchCache () {
        return new Promise((resolve) => {
            this.query(`
                SELECT * FROM users_caches
            `).then((rows) => {
                this.usersCaches = rows.map((row) => {
                    return {
                        pronoteURL: row.pronote_url,
                        pronoteUsername: row.pronote_username,
                        homeworksCache: row.homeworks_cache,
                        marksCache: row.marks_cache
                    }
                })
                resolve()
            })
        })
    }

    fetchTokens () {
        return new Promise((resolve) => {
            this.query(`
                SELECT * FROM users_tokens
            `).then((rows) => {
                this.usersTokens = rows.map((row) => {
                    return {
                        pronoteURL: row.pronote_url,
                        pronoteUsername: row.pronote_username,
                        fcmToken: row.fcm_token,
                        createdAt: row.created_at,
                        isActive: row.is_active,
                        notificationsMarks: row.notifications_marks,
                        notificationsHomeworks: row.notifications_homeworks
                    }
                })
                resolve()
            })
        })
    }

    fetchNotifications () {
        return new Promise((resolve) => {
            this.query(`
                SELECT * FROM notifications
            `).then((rows) => {
                this.notifications = rows.map((row) => {
                    return {
                        pronoteURL: row.pronote_url,
                        pronoteUsername: row.pronote_username,
                        createdAt: row.created_at,
                        readAt: row.read_at,
                        sentAt: row.sent_at,
                        body: row.body,
                        title: row.title,
                        type: row.type
                    }
                })
                resolve()
            })
        })
    }

    markLastActiveAt (token, date) {
        return new Promise((resolve) => {
            this.query(`
                UPDATE users_tokens
                SET last_active_at = '${date.toISOString()}'
                WHERE fcm_token = '${token}';
            `).then(() => {
                resolve()
            })
        })
    }

    markLastSuccessAt (token, date) {
        return new Promise((resolve) => {
            this.query(`
                UPDATE users_tokens
                SET last_success_at = '${date.toISOString()}'
                WHERE fcm_token = '${token}';
            `).then(() => {
                resolve()
            })
        })
    }

    updateUserCache ({ pronoteUsername, pronoteURL }, { homeworksCache, marksCache }) {
        return new Promise((resolve) => {
            const homeworksCacheValue = quoteEscape(JSON.stringify(homeworksCache))
            const marksCacheValue = quoteEscape(JSON.stringify(marksCache))
            this.query(`
                INSERT INTO users_caches
                    (pronote_username, pronote_url, homeworks_cache, marks_cache, last_update_at) VALUES
                    ('${pronoteUsername}', '${pronoteURL}', '${homeworksCacheValue}', '${marksCacheValue}', '${new Date().toISOString()}')
                ON CONFLICT ON CONSTRAINT users_caches_pkey DO
                    UPDATE SET homeworks_cache = excluded.homeworks_cache, marks_cache = excluded.marks_cache, last_update_at = excluded.last_update_at;
            `).then(() => {
                this.usersCaches = this.usersCaches.filter((cache) => {
                    return !(cache.pronoteUsername === pronoteUsername && cache.pronoteURL === pronoteURL)
                })
                this.usersCaches.push({
                    pronoteUsername,
                    pronoteURL,
                    homeworksCache,
                    marksCache
                })
                resolve()
            })
        })
    }

    invalidateUserPassword ({ pronoteUsername, pronoteURL }, invalidate = true) {
        return new Promise((resolve) => {
            this.query(`
                UPDATE users
                SET password_invalidated = ${invalidate}
                WHERE pronote_username = '${pronoteUsername}'
                AND pronote_url = '${pronoteURL}';
            `).then(() => {
                const existingUser = this.users.find((user) => {
                    return user.pronoteUsername === pronoteUsername && user.pronoteURL === pronoteURL
                })
                this.users = this.users.filter((user) => {
                    return !(user.pronoteUsername === pronoteUsername && user.pronoteURL === pronoteURL)
                })
                this.users.push({
                    ...existingUser,
                    ...{
                        passwordInvalidated: invalidate
                    }
                })
                resolve()
            })
        })
    }

    updateUserPassword ({ pronoteUsername, pronoteURL, newPassword }) {
        return new Promise((resolve) => {
            this.query(`
                UPDATE users
                SET pronote_password = '${newPassword}'
                WHERE pronote_username = '${pronoteUsername}'
                AND pronote_url = '${pronoteURL}';
            `).then(() => {
                const existingUser = this.users.find((user) => {
                    return user.pronoteUsername === pronoteUsername && user.pronoteURL === pronoteURL
                })
                this.users = this.users.filter((user) => {
                    return !(user.pronoteUsername === pronoteUsername && user.pronoteURL === pronoteURL)
                })
                this.users.push({
                    ...existingUser,
                    ...{
                        pronotePassword: newPassword
                    }
                })
                resolve()
            })
        })
    }

    createUser ({ pronoteUsername, pronotePassword, pronoteURL, pronoteCAS, avatarBase64, fullName, studentClass, establishment }) {
        return new Promise((resolve) => {
            this.query(`
                INSERT INTO users
                (pronote_username, pronote_password, pronote_url, pronote_cas, avatar_base64, full_name, student_class, establishment, created_at) VALUES
                ('${pronoteUsername}', '${pronotePassword}', '${pronoteURL}', '${pronoteCAS}', '${avatarBase64}', '${fullName}', '${studentClass}', '${establishment}', '${new Date().toISOString()}');
            `).then(() => {
                const user = {
                    pronoteUsername,
                    pronotePassword,
                    pronoteURL,
                    pronoteCAS,
                    avatarBase64,
                    fullName,
                    studentClass,
                    establishment
                }
                this.users.push(user)
                resolve(user)
            })
        })
    }

    updateToken (token, data) {
        return new Promise((resolve) => {
            const updates = []
            if (Object.prototype.hasOwnProperty.call(data, 'notificationsHomeworks')) updates.push(`notifications_homeworks = ${data.notificationsHomeworks}`)
            if (Object.prototype.hasOwnProperty.call(data, 'notificationsMarks')) updates.push(`notifications_marks = ${data.notificationsMarks}`)
            if (Object.prototype.hasOwnProperty.call(data, 'isActive')) updates.push(`is_active = ${data.isActive}`)
            this.query(`
                UPDATE users_tokens
                SET ${updates.join(', ')}
                WHERE fcm_token = '${token}';
            `).then(() => {
                const tokenData = this.usersTokens.find((t) => t.fcmToken === token)
                this.usersTokens = this.usersTokens.filter((t) => t.fcmToken !== token)
                const updatedTokenData = {
                    ...tokenData,
                    ...data
                }
                this.usersTokens.push(updatedTokenData)
                resolve(updatedTokenData)
            })
        })
    }

    createOrUpdateToken ({ pronoteUsername, pronoteURL }, token) {
        return new Promise((resolve) => {
            this.query(`
                INSERT INTO users_tokens
                (pronote_username, pronote_url, fcm_token, is_active, notifications_homeworks, notifications_marks) VALUES
                ('${pronoteUsername}', '${pronoteURL}', '${token}', true, true, true)
                ON CONFLICT ON CONSTRAINT users_tokens_pkey DO
                    UPDATE SET pronote_username = excluded.pronote_username,
                    pronote_url = excluded.pronote_url,
                    is_active = true,
                    notifications_homeworks = true,
                    notifications_marks = true;
            `).then(() => {
                const userToken = {
                    pronoteUsername,
                    pronoteURL,
                    fcmToken: token,
                    isActive: true,
                    notificationsHomeworks: true,
                    notificationsMarks: true
                }
                this.usersTokens.push(userToken)
                resolve(userToken)
            })
        })
    }

    createNotification ({ pronoteUsername, pronoteURL }, { type, title, body }) {
        return new Promise((resolve) => {
            const id = Math.random().toString(36).substr(2, 9)
            const createdAt = new Date().toISOString()
            this.query(`
                INSERT INTO notifications
                (notification_id, pronote_username, pronote_url, sent_at, read_at, type, title, body, created_at) VALUES
                ('${id}', '${pronoteUsername}', '${pronoteURL}', null, null, '${type}', '${quoteEscape(title)}', '${quoteEscape(body)}', '${createdAt}');
            `).then(() => {
                const notificationData = {
                    id,
                    pronoteUsername,
                    pronoteURL,
                    type,
                    title,
                    body,
                    createdAt: new Date(createdAt)
                }
                this.notifications.push(notificationData)
                resolve(notificationData)
            })
        })
    }

    markNotificationSent (id, sentAt) {
        return new Promise((resolve) => {
            this.query(`
                UPDATE notifications
                SET sent_at = '${sentAt.toISOString()}'
                WHERE notification_id = '${id}';
            `).then(() => {
                const notificationData = this.notifications.find((n) => n.id === id)
                this.notifications = this.notifications.filter((n) => n.id !== id)
                const updatedNotificationData = {
                    ...notificationData,
                    ...{
                        sentAt
                    }
                }
                this.notifications.push(updatedNotificationData)
                resolve(updatedNotificationData)
            })
        })
    }

    markNotificationRead (id, readAt) {
        return new Promise((resolve) => {
            this.query(`
                UPDATE notifications
                SET read_at = '${readAt.toISOString()}'
                WHERE notification_id = '${id}';
            `).then(() => {
                const notificationData = this.notifications.find((n) => n.id === id)
                this.notifications = this.usersTokens.filter((n) => n.id !== id)
                const updatedNotificationData = {
                    ...notificationData,
                    ...{
                        readAt
                    }
                }
                this.notifications.push(updatedNotificationData)
                resolve(updatedNotificationData)
            })
        })
    }
};

module.exports = DatabaseService
