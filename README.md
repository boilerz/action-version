# @boilerz/action-version

[![GH CI Action](https://github.com/boilerz/action-release/workflows/CI/badge.svg)](https://github.com/boilerz/action-release/actions?query=workflow:CI)
[![codecov](https://codecov.io/gh/boilerz/action-release/branch/master/graph/badge.svg)](https://codecov.io/gh/boilerz/action-release)

> Github action that check changes and version accordingly

### Usage

See [action.yml](action.yml)

Basic:
```yaml
  build:
    if: "!contains(github.event.head_commit.message, ':bookmark:')" # Skip build for version commits (only use when push are triggered by a bot PAT)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
          with:
            token: ${{ secrets.GH_BOT_TOKEN }} # Bot token if branch is protected
      - uses: actions/setup-node@v2
        with:
          node-version: '12.x'
    
      - uses: boilerz/action-version@master
        if: github.ref == 'refs/heads/master' 
        with:
          publishDirectory: 'dist'
          buildStep: 'true'
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_EMAIL: ${{ secrets.GITHUB_EMAIL }}
          GITHUB_USER: ${{ secrets.GITHUB_USER }}
```
