# Nodejs script to download and copy gitlab artifacts

A deploy script to get details of last build and deploy the build artifacts to a specific folder.

## Configuration

Configuring through environment variables

### HOST

Gitlab hostname

Example:
`HOST=gilab.com`

### TOKEN

Gitlab token

Example:
`TOKEN=Gitlab-Token`


### DEST_DIR

Path to the destination directory

Example:
`DEST_DIR=/var/www/website/web`


### BACKUP_DIR

Path to the directory where backups should be placed

Example:
`BACKUP_DIR=/var/www/website/backup`


### CI_PROJECT_ID

Project ID on gitlab

Example:
`CI_PROJECT_ID="921928477383939"`


### CI_BUILD_REF

Commit hash

Example:
`CI_BUILD_REF="9c90d1zcbe8a1ecm2006a4858ac73w97ffe9d20a"`



```
BACKUP_DIR="$PWD/backup" DEST_DIR="$PWD/dest" CI_PROJECT_ID="921928477383939" CI_BUILD_REF="9c90d1zcbe8a1ecm2006a4858ac73w97ffe9d20a" HOST=gitlab.com TOKEN="Gitlab-Token" node index.js
```
