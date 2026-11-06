# Spotify weekly discovery container

The container stays running and searches every Friday at 03:00 in `Europe/Berlin`. It appends all matching tracks it finds from releases dated in the previous seven days. It skips tracks already in the target playlist or Liked Songs, and does not remove or reorder existing items. There is no per-run track cap.

Spotify values and credentials belong in `container/.env` and `container/data/.spotify-tokens.json`; both are excluded from Git. Do not commit either file.

## Configure on the server

Clone this repository on the server, then create the private configuration and token directory:

```sh
git clone <your-github-repository-url> ~/spotify-weekly
cd ~/spotify-weekly
cp container/.env.example container/.env
mkdir -p container/data
chmod 700 container/data
```

Edit `container/.env` with your Spotify app Client ID and target playlist ID. The optional French and US artist lists accept comma-separated names. Set `SPOTIFY_UID` and `SPOTIFY_GID` to the numeric IDs shown by `id -u` and `id -g` on the server.

Copy the existing authorized token file from your Mac to the server and restrict its permissions:

```sh
scp /path/to/.spotify-tokens.json <server-user>@<server-host>:~/spotify-weekly/container/data/.spotify-tokens.json
ssh <server-user>@<server-host> 'chmod 600 ~/spotify-weekly/container/data/.spotify-tokens.json'
```

Build and start the service:

```sh
docker compose -f container/compose.yaml up -d --build
```

The container restarts with Docker after a server reboot and exposes no ports. View logs or stop it with:

```sh
docker compose -f container/compose.yaml logs -f --tail 100
docker compose -f container/compose.yaml down
```

When Spotify requires authorization again, refresh the token locally, copy the new token file to the same data path, then restart the service.
