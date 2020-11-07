module.exports.run = (pool) => {
    return pool.query(`
    
        ALTER TABLE users
        ADD password_invalidated boolean,
        created_at timestamptz;

        ALTER TABLE users_caches
        ADD last_update_at timestamptz;

        ALTER TABLE users_tokens
        ADD last_active_at timestamptx,
        last_sent_at timestamptx;

    `)
}
