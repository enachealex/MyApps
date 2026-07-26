# MyApps

Small apps, one per folder. Each deploys itself to GitHub Pages under its own path.

| App | Folder | Live |
| --- | --- | --- |
| OnCall Schedule | [`oncall/`](oncall) | https://enachealex.github.io/MyApps/oncall/ |

## Adding another app

1. Create a folder with its own `package.json`.
2. Copy `.github/workflows/deploy-oncall.yml`, change the paths, `working-directory`, and `destination_dir`.
3. Set `base` in its `vite.config.js` to `/MyApps/<folder>/`.

`keep_files: true` in the workflow means each app publishes into its own
subfolder without clobbering the others.
