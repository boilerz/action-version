import * as os from 'os';

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import type { components } from '@octokit/openapi-types';

import * as packageHelper from './package-helper';

export type Commit = components['schemas']['commit'];

export type SimpleCommit = components['schemas']['simple-commit'];

export type File = components['schemas']['diff-entry'];

export type BumpType = 'patch' | 'minor' | 'major';

export type Comparison = Pick<
  components['schemas']['commit-comparison'],
  'commits' | 'files'
>;

enum CommitType {
  DEPENDENCY_UPDATE = ':arrow_up:',
  FEATURE = ':sparkles:',
  BUG = ':bug:',
  MERGE = ':twisted_rightwards_arrows:',
  OTHER = ':card_file_box:',
}

enum PullRequestLabel {
  DEPENDENCIES = 'dependencies',
}

export interface EnhancedCommit extends Commit {
  type: CommitType;
}

interface FileChecker {
  regex: RegExp;
  check?(file: File): boolean;
}

const MERGE_MESSAGE_REGEX = /.*[Mm]erge.*/;

const UNWORTHY_RELEASE_FILE_CHECKERS: FileChecker[] = [
  {
    regex: /package\.json/,
    check(file: File): boolean {
      return file.patch ? file.patch.includes('version') : false;
    },
  },
  {
    regex: /^\.?(github|husky|eslintignore|eslintrc|gitignore|yarnrc|LICENCE|README|tsconfig).*/,
  },
  {
    regex: /.*\.spec\.[j|t]sx?]$/,
  },
];

function extractDependency(commit: Commit): string {
  const { message } = commit.commit;
  const regexResult = /^.*Bump (.*) from .*/.exec(message);
  if (!regexResult || regexResult.length < 2) {
    core.warning(`⚠️ Malformed bump commit message : ${message}`);
    return '';
  }
  const dependency = regexResult[1];
  core.info(
    `📦 Retrieved ${dependency} from message: ${message.split('\n')[0]}`,
  );
  return dependency;
}

export async function areDiffWorthRelease({
  files,
  commits,
}: Comparison): Promise<boolean> {
  const nonMergeCommits = commits.filter(
    ({ commit: { message } }) => !MERGE_MESSAGE_REGEX.test(message),
  );
  core.info(`↩️ Non merge commits found ${nonMergeCommits.length}`);
  commits.forEach(({ commit: { message } }) =>
    core.info(`📦 ${message.split('\n')}`),
  );
  const devDependencies = await packageHelper.getDevDependencies();
  core.info(`📦👨‍💻 Dev dependencies : ${devDependencies.join(',')}`);
  const devDependenciesUpdate = nonMergeCommits
    .filter(({ commit: { message } }) =>
      message.startsWith(CommitType.DEPENDENCY_UPDATE),
    )
    .map(extractDependency)
    .filter((dependency) => devDependencies.includes(dependency));
  devDependenciesUpdate.forEach((dependency) =>
    core.info(`📦👨‍💻 ${dependency}`),
  );
  if (devDependenciesUpdate.length === nonMergeCommits.length) {
    core.info('👨‍💻 Commits contain only dev dependencies update');
    return false;
  }

  if (!files) return false;

  const worthyReleaseFiles = files.filter(
    (file) =>
      !UNWORTHY_RELEASE_FILE_CHECKERS.some(
        (fileChecker) =>
          fileChecker.regex.test(file.filename) &&
          (fileChecker.check ? fileChecker.check(file) : true),
      ),
  );
  core.debug(
    `📄 Updated files: ${files.map((file) => file.filename).join(',')}`,
  );
  core.debug(
    `📄 Worthy release files: ${worthyReleaseFiles
      .map((file) => file.filename)
      .join(',')}`,
  );
  return worthyReleaseFiles.length > 0;
}

export async function retrieveChangesSinceLastRelease(
  githubToken: string,
): Promise<Comparison> {
  const { repo, owner } = github.context.repo;
  const octokit = github.getOctokit(githubToken);
  const { data: tags } = await octokit.repos.listTags({
    repo,
    owner,
    per_page: 1,
  });

  const { data: lastCommits } = await octokit.repos.listCommits({
    repo,
    owner,
  });

  const [{ sha: head }] = lastCommits;
  let { sha: base } = lastCommits[lastCommits.length - 1]; // good enough approximation
  if (tags?.length) [{ name: base }] = tags;

  core.info(`🏷 Retrieving commits since ${base}`);
  const {
    data: { commits, diff_url, files },
  } = await octokit.repos.compareCommits({ owner, repo, base, head });
  core.info(`🔗 Diff url : ${diff_url}`);
  return { commits, files };
}

export async function hasPendingDependencyPRsOpen(
  githubToken: string,
): Promise<boolean> {
  const { repo, owner } = github.context.repo;
  const { data: openPRs } = await github
    .getOctokit(githubToken)
    .pulls.list({ repo, owner, state: 'open' });

  return openPRs.some((pr) =>
    pr.labels.some((label) => label.name === PullRequestLabel.DEPENDENCIES),
  );
}

async function isBranchBehind(): Promise<boolean> {
  let isBehind = false;
  await exec.exec('git', ['status', '-uno'], {
    listeners: {
      stdout(data: Buffer): void {
        isBehind = data.toString().includes('is behind');
      },
    },
  });
  return isBehind;
}

export function getCurrentBranch(githubRef: string | undefined): string {
  if (!githubRef) throw new Error('Failed to detect branch');

  const currentBranch = /refs\/[a-zA-Z]+\/(.*)/.exec(githubRef);
  if (!currentBranch || currentBranch?.length < 2) {
    core.error(`🙊 Malformed branch ${currentBranch}`);
    throw new Error('Cannot retrieve branch name from GITHUB_REF');
  }

  return currentBranch[1];
}

export function detectBumpType(commits: Commit[]): BumpType {
  if (!commits.length) throw new Error('Failed to access commits');

  const lastCommit = commits[commits.length - 1];

  let bumpType: BumpType = 'patch';
  const [lastCommitMessage] = lastCommit.commit.message.split(os.EOL);
  if (
    lastCommitMessage.includes('minor') ||
    lastCommitMessage.includes('feat') ||
    lastCommitMessage.startsWith(CommitType.FEATURE)
  ) {
    bumpType = 'minor';
  }
  return bumpType;
}

export async function version(
  bumpType: BumpType,
  githubEmail: string,
  githubUser: string,
): Promise<boolean> {
  core.info('📒 Setting git config');
  await exec.exec('git', ['config', 'user.name', `"${githubUser}"`]);
  await exec.exec('git', ['config', 'user.email', `"${githubEmail}"`]);

  core.info('🔖 Version patch');
  await exec.exec('yarn', ['version', `--${bumpType}`]);

  if (await isBranchBehind()) return false;

  core.info('📌 Pushing release commit message and tag');
  await exec.exec('git', ['push']);
  await exec.exec('git', ['push', '--tags']);
  return true;
}
