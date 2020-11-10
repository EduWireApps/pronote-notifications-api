module.exports.run = (pool) => {
    return pool.query(`
    
        ALTER TABLE users
        ADD COLUMN password_invalidated BOOLEAN,
        ADD COLUMN created_at TIMESTAMP WITH TIME ZONE;

        ALTER TABLE users_caches
        ADD COLUMN last_update_at TIMESTAMP WITH TIME ZONE;

        ALTER TABLE users_tokens
        ADD COLUMN last_success_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN last_sent_at TIMESTAMP WITH TIME ZONE;

    `)
}
