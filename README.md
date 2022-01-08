# Deprecated / Archived
The [official Lando project](https://github.com/lando/lando) now aggregates the subprojects. This project is no longer necessary.

# A superproject to aggregate the various Lando projects
Perform the following steps to have all of the Lando projects cloned into your local.
```bash
git clone --recursive --origin upstream git@github.com:AaronFeledy/lando-super.git lando
cd lando
git submodule update --init --recursive --remote
```
