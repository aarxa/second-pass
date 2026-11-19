# Moving the database from Render to Neon

Render's free Postgres is deleted 30 days after creation (around 2026-12-09). Neon's free tier
doesn't expire. Moving takes about 15 minutes and no code changes: the app only needs a different
`DATABASE_URL`, and its migrations create the schema automatically.

## 1. Create the Neon database
1. Sign up at https://neon.tech (GitHub sign-in is easiest).
2. Create a project: name `shaderlab`, Postgres 17 or 18, region **AWS US West (Oregon)**, which is the
   same region as the Render app, so queries stay fast.
3. On the project dashboard, open **Connect**, keep "Pooled connection" **off**, and copy the
   connection string. It looks like
   `postgresql://neondb_owner:...@ep-xxxx.us-west-2.aws.neon.tech/neondb?sslmode=require`.
   If Neon shows a `.env` block instead, use `DATABASE_URL` (the one whose address has no `-pooler`),
   not `DATABASE_URL_POOLED`. Skip Neon's "set up with your coding agent" prompt: the app already has
   its database code and only needs this string.

## 2. Copy the data (in a terminal, from the `shaderlab` folder)
Open **Docker Desktop** first (the script runs the Postgres tools in Docker). In Render: open
**shaderlab-db**, then **Connect**, switch to the **External** tab, and copy the **External Database
URL**. Its address ends in `.oregon-postgres.render.com`; the Internal one (`dpg-...-a` with nothing
after it) only works inside Render.
```bash
export SRC_DATABASE_URL='<Render external URL>'
export DST_DATABASE_URL='<Neon connection string>'
./scripts/move-db.sh
```
It prints the number of shaders copied and the migrations recorded (`1,2,3,4` at the time of the move;
later migrations are applied automatically when the server starts). If a pasted
address breaks across lines (the prompt turns into `>`), press Ctrl+C and paste it again on one line.

## 3. Point the app at Neon
In Render: **shaderlab** (the web service), then **Environment**. Edit `DATABASE_URL`, paste the Neon
connection string ending at `?sslmode=require` (leave off any `&channel_binding=require`), and save.
Make sure a deploy runs after the change (Events); the running site keeps the old value until it does.

Then check that the live site writes to the new database: create a shader on the site, and Neon's
`select count(*) from shaders` should go up by one.

Finally, reset the Neon password (Roles, then neondb_owner, then Reset password) and update
`DATABASE_URL` once more: the copy step typed both passwords into your terminal and shell history.

## 4. Later
Once everything has worked for a few days, delete `shaderlab-db` on Render and remove the
`databases:` block and the `fromDatabase` reference from `render.yaml` (otherwise Render would
recreate it).
