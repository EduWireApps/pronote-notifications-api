module.exports.run = (pool) => {
    return pool.query(`
    
        ALTER TABLE users_tokens
        ADD COLUMN device_id CHARACTER VARYING;

        CREATE TABLE public.users_caches_logs
        (
            pronote_username character varying COLLATE pg_catalog."default" NOT NULL,
            pronote_url character varying COLLATE pg_catalog."default" NOT NULL,
            homeworks_cache json NOT NULL,
            marks_cache json NOT NULL,
            date timestamp with time zone NOT NULL
        )


        CREATE TABLE public.users_logs
        (
            pronote_username character varying COLLATE pg_catalog."default" NOT NULL,
            pronote_url character varying COLLATE pg_catalog."default" NOT NULL,
            route character varying COLLATE pg_catalog."default" NOT NULL,
            fcm_token character varying COLLATE pg_catalog."default" NOT NULL,
            app_version character varying COLLATE pg_catalog."default" NOT NULL,
            date timestamp with time zone NOT NULL,
            req_body json
        )

    `)
}
