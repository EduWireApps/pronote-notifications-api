const config = require('../config.json')
const { Pool } = require('pg')

const formatUser = (row) => ({
    pronoteURL: row.pronote_url,
    pronoteUsername: row.pronote_username,
    pronotePassword: row.pronote_password,
    pronoteCAS: row.pronote_cas,
    fullName: row.full_name,
    studentClass: row.student_class,
    establishment: row.establishment,
    passwordInvalidated: row.password_invalidated
})

const formatFCMToken = (row) => ({
    pronoteURL: row.pronote_url,
    pronoteUsername: row.pronote_username,
    fcmToken: row.fcm_token,
    createdAt: row.created_at,
    isActive: row.is_active,
    notificationsMarks: row.notifications_marks,
    notificationsHomeworks: row.notifications_homeworks
})

class DatabaseService {
    constructor () {
        this.pool = new Pool(config.database)
            .on('connect', () => {
                console.log('Connected to PostgreSQL database')
            })
            .on('error', (e) => console.error(e))
    }

    query (query, ...parameters) {
        return new Promise((resolve) => {
            this.pool.query(query, parameters, (error, res) => {
                if (!error) resolve(res)
                else console.error(error)
            })
        })
    }

    fetchFCMToken (fcmToken) {
        return new Promise((resolve) => {
            this.query(`
                SELECT * FROM users_tokens
                WHERE fcm_token = $1;
            `, fcmToken).then(({ rowCount, rows }) => {
                resolve(rowCount > 0 ? formatFCMToken(rows[0]) : null)
            })
        })
    }

    fetchUser (pronoteUsername, pronoteURL) {
        return new Promise((resolve) => {
            this.query(`
                SELECT * FROM users_2021
                WHERE pronote_username = $1
                AND pronote_url = $2;
            `, pronoteUsername, pronoteURL).then(({ rows, rowCount }) => {
                resolve(rowCount > 0 ? formatUser(rows[0]) : null)
            })
        })
    }

    fetchUsers () {
        return new Promise((resolve) => {
            this.query(`
                SELECT * FROM users_2021;
            `).then(({ rows }) => {
                resolve(rows.map((row) => formatUser(row)))
            })
        })
    }

    fetchUsersCache () {
        return new Promise((resolve) => {
            this.query(`
                SELECT * FROM users_caches;
            `).then(({ rows }) => {
                resolve(rows.map((row) => ({
                    pronoteURL: row.pronote_url,
                    pronoteUsername: row.pronote_username,
                    homeworksCache: row.homeworks_cache,
                    marksCache: row.marks_cache
                })))
            })
        })
    }

    fetchFCMTokens () {
        return new Promise((resolve) => {
            this.query(`
                SELECT * FROM users_tokens;
            `).then(({ rows }) => {
                resolve(rows.map((row) => formatFCMToken(row)))
            })
        })
    }

    fetchUserNotifications (pronoteUsername, pronoteURL) {
        return new Promise((resolve) => {
            this.query(`
                SELECT * FROM notifications_2021
                WHERE pronote_username = $1
                AND pronote_url = $2;
            `, pronoteUsername, pronoteURL).then(({ rows }) => {
                resolve(rows.map((row) => ({
                    pronoteURL: row.pronote_url,
                    pronoteUsername: row.pronote_username,
                    createdAt: row.created_at,
                    readAt: row.read_at,
                    sentAt: row.sent_at,
                    body: row.body,
                    title: row.title,
                    type: row.type
                })))
            })
        })
    }

    markLastActiveAt (token, date) {
        return new Promise((resolve) => {
            this.query(`
                UPDATE users_tokens
                SET last_active_at = $1
                WHERE fcm_token = $2;
            `, date.toISOString(), token).then(() => {
                resolve()
            })
        })
    }

    markLastSuccessAt (token, date) {
        return new Promise((resolve) => {
            this.query(`
                UPDATE users_tokens
                SET last_success_at = $1
                WHERE fcm_token = $2;
            `, date.toISOString(), token).then(() => {
                resolve()
            })
        })
    }

    updateUserCache ({ pronoteUsername, pronoteURL }, { homeworksCache, marksCache }) {
        return new Promise((resolve) => {
            const date = new Date().toISOString()
            this.query(`
                INSERT INTO users_caches
                    (pronote_username, pronote_url, homeworks_cache, marks_cache, last_update_at) VALUES
                    ($1, $2, $3, $4, $5)
                ON CONFLICT ON CONSTRAINT users_caches_pkey DO
                    UPDATE SET homeworks_cache = excluded.homeworks_cache, marks_cache = excluded.marks_cache, last_update_at = excluded.last_update_at;
            `, pronoteUsername, pronoteURL, JSON.stringify(homeworksCache), JSON.stringify(marksCache), date).then(() => {
                resolve()
            })
        })
    }

    invalidateUserPassword ({ pronoteUsername, pronoteURL }, invalidate = true) {
        return new Promise((resolve) => {
            this.query(`
                UPDATE users_2021
                SET password_invalidated = $1
                WHERE pronote_username = $2
                AND pronote_url = $3;
            `, invalidate, pronoteUsername, pronoteURL).then(() => {
                resolve()
            })
        })
    }

    updateUserPassword ({ pronoteUsername, pronoteURL, newPassword }) {
        return new Promise((resolve) => {
            this.query(`
                UPDATE users_2021
                SET pronote_password = $1
                WHERE pronote_username = $2
                AND pronote_url = $3;
            `, newPassword, pronoteUsername, pronoteURL).then(() => {
                resolve()
            })
        })
    }

    createUser ({ pronoteUsername, pronotePassword, pronoteURL, pronoteCAS, fullName, studentClass, establishment }) {
        return new Promise((resolve) => {
            this.query(`
                INSERT INTO users_2021
                (pronote_username, pronote_password, pronote_url, pronote_cas, full_name, student_class, establishment, created_at) VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8);
            `, pronoteUsername, pronotePassword, pronoteURL, pronoteCAS, fullName, studentClass, establishment, new Date().toISOString()).then(() => {
                resolve()
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
                WHERE fcm_token = $1;
            `, token).then(() => {
                resolve()
            })
        })
    }

    createOrUpdateToken ({ pronoteUsername, pronoteURL }, token, deviceID) {
        return new Promise((resolve) => {
            this.query(`
                INSERT INTO users_tokens
                (pronote_username, pronote_url, fcm_token, is_active, notifications_homeworks, notifications_marks, device_id) VALUES
                ($1, $2, $3, true, true, true, $4)
                ON CONFLICT ON CONSTRAINT users_tokens_pkey DO
                    UPDATE SET is_active = true,
                    notifications_homeworks = true,
                    notifications_marks = true;
            `, pronoteUsername, pronoteURL, token, deviceID).then(() => {
                resolve()
            })
        })
    }

    createNotification ({ pronoteUsername, pronoteURL }, { type, title, body }) {
        return new Promise((resolve) => {
            const id = Math.random().toString(36).substr(2, 9)
            const createdAt = new Date().toISOString()
            this.query(`
                INSERT INTO notifications_2021
                (notification_id, pronote_username, pronote_url, sent_at, read_at, type, title, body, created_at) VALUES
                ($1, $2, $3, null, null, $4, $5, $6, $7);
            `, id, pronoteUsername, pronoteURL, type, title, body, createdAt).then(() => {
                resolve(id)
            })
        })
    }

    markNotificationSent (id, sentAt) {
        return new Promise((resolve) => {
            this.query(`
                UPDATE notifications_2021
                SET sent_at = $1
                WHERE notification_id = $2;
            `, sentAt.toISOString(), id).then(() => {
                resolve()
            })
        })
    }

    markNotificationRead (id, readAt) {
        return new Promise((resolve) => {
            this.query(`
                UPDATE notifications_2021
                SET read_at = $1
                WHERE notification_id = $2;
            `, readAt.toISOString(), id).then(() => {
                resolve()
            })
        })
    }

    createUserLog ({ pronoteUsername, pronoteURL, fcmToken }, { route, appVersion, date = new Date(), body, jwt }) {
        return this.query(`
            INSERT INTO users_logs
            (pronote_username, pronote_url, fcm_token, route, app_version, date, jwt, req_body) VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8);
        `, pronoteUsername, pronoteURL, fcmToken, route, appVersion, date.toISOString(), jwt, body)
    }
};

module.exports = DatabaseService
