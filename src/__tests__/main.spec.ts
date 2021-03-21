import * as core from '@actions/core';
import * as github from '@actions/github';

import * as gitHelper from '../git-helper';
import { BumpType, Comparison } from '../git-helper';
import run, { defaultRunOptions } from '../main';
import { comparison } from './__fixtures/comparison';

function mockInputs(inputs: Record<string, string>): jest.SpyInstance {
  return jest.spyOn(core, 'getInput').mockImplementation((name) => {
    return inputs[name] || '';
  });
}

function mockReturnedValueOf(value: {
  getCurrentBranch?: string;
  detectBumpType?: BumpType;
  hasPendingDependencyPRsOpen?: boolean;
  retrieveChangesSinceLastRelease?: Comparison;
  areDiffWorthRelease?: boolean;
  version?: boolean;
}) {
  if (value.getCurrentBranch) {
    jest
      .spyOn(gitHelper, 'getCurrentBranch')
      .mockReturnValue(value.getCurrentBranch);
  }
  if (value.detectBumpType) {
    jest
      .spyOn(gitHelper, 'detectBumpType')
      .mockReturnValue(value.detectBumpType);
  }
  if (value.retrieveChangesSinceLastRelease) {
    jest
      .spyOn(gitHelper, 'retrieveChangesSinceLastRelease')
      .mockResolvedValue(value.retrieveChangesSinceLastRelease);
  }
  if (typeof value.hasPendingDependencyPRsOpen === 'boolean') {
    jest
      .spyOn(gitHelper, 'hasPendingDependencyPRsOpen')
      .mockResolvedValue(value.hasPendingDependencyPRsOpen);
  }
  if (typeof value.areDiffWorthRelease === 'boolean') {
    jest
      .spyOn(gitHelper, 'areDiffWorthRelease')
      .mockResolvedValue(value.areDiffWorthRelease);
  }
  if (typeof value.version === 'boolean') {
    jest.spyOn(gitHelper, 'version').mockResolvedValue(value.version);
  }
}

describe('gh action', () => {
  const runOptions = { ...defaultRunOptions, githubToken: 'github.token' };

  let versionSpy: jest.SpyInstance;

  beforeEach(() => {
    versionSpy = jest.spyOn(gitHelper, 'version').mockResolvedValue(true);
  });

  it('should fail without GITHUB_TOKEN', async () => {
    const setFailedSpy = jest.spyOn(core, 'setFailed');

    await run();

    expect(setFailedSpy).toHaveBeenCalledWith(`⛔️ Missing GITHUB_TOKEN`);
  });

  it('should set status to failed when an error occur', async () => {
    jest.spyOn(core, 'getInput').mockImplementation(() => {
      throw new Error('Unknown');
    });

    const setFailedSpy = jest.spyOn(core, 'setFailed');

    await run(runOptions);

    expect(setFailedSpy).toHaveBeenCalledWith('Unknown');
  });

  it('should skip when version flag is set to false', async () => {
    mockInputs({ version: 'false' });
    const warningSpy = jest.spyOn(core, 'warning');
    await run(runOptions);

    expect(warningSpy).toHaveBeenCalledWith(
      '🚩 Skipping version (flag false), release and publish',
    );
  });

  it('should skip if the current branch is not the base branch', async () => {
    mockInputs({ version: 'true', baseBranch: 'master' });
    jest.spyOn(gitHelper, 'getCurrentBranch').mockReturnValue('foo');
    const warningSpy = jest.spyOn(core, 'warning');

    await run(runOptions);

    expect(warningSpy).toHaveBeenCalledWith(
      '🚫 Current branch: foo, releasing only from master',
    );
  });

  it('should skip if the only one commit is a version commit pushed by the bot', async () => {
    const originalCommits = github.context.payload.commits;
    const originalActor = github.context.actor;
    const infoSpy = jest.spyOn(core, 'info');
    github.context.actor = process.env.GITHUB_USER || 'boilerz-bot';
    github.context.payload.commits = [
      {
        message: ':bookmark: v0.0.1',
      },
    ];

    await run(runOptions);

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Skipping, version commit pushed by .*/),
    );
    github.context.payload.commits = originalCommits;
    github.context.actor = originalActor;
  });

  it('should skip if dependencies PRs found open', async () => {
    const warnSpy = jest.spyOn(core, 'warning');
    mockInputs({ version: 'true', baseBranch: 'master' });
    mockReturnedValueOf({
      getCurrentBranch: 'master',
      hasPendingDependencyPRsOpen: true,
    });
    await run(runOptions);

    expect(warnSpy).toHaveBeenCalledWith(
      '🚧 Skipping, dependencies PRs found open',
    );
  });

  it('should skip if changes does not worth a release', async () => {
    const infoSpy = jest.spyOn(core, 'info');
    mockInputs({ version: 'true', baseBranch: 'master' });
    mockReturnedValueOf({
      getCurrentBranch: 'master',
      hasPendingDependencyPRsOpen: false,
      areDiffWorthRelease: false,
      retrieveChangesSinceLastRelease: comparison,
    });
    await run(runOptions);

    expect(infoSpy).toHaveBeenCalledWith('⏩ Skipping the release');
  });

  it('should skip if branch is behind', async () => {
    const infoSpy = jest.spyOn(core, 'info');
    mockInputs({ version: 'true', baseBranch: 'master' });
    mockReturnedValueOf({
      getCurrentBranch: 'master',
      hasPendingDependencyPRsOpen: false,
      areDiffWorthRelease: true,
      retrieveChangesSinceLastRelease: comparison,
      version: false,
    });
    await run(runOptions);

    expect(infoSpy).toHaveBeenCalledWith(
      '⏩ Skipping this release, branch behind master',
    );
  });

  it('should version successfully', async () => {
    mockInputs({ version: 'true', baseBranch: 'master' });
    mockReturnedValueOf({
      getCurrentBranch: 'master',
      detectBumpType: 'patch',
      hasPendingDependencyPRsOpen: false,
      retrieveChangesSinceLastRelease: comparison,
      areDiffWorthRelease: true,
    });

    await run(runOptions);

    expect(versionSpy).toMatchInlineSnapshot(`
      [MockFunction] {
        "calls": Array [
          Array [
            "patch",
            "77937117+boilerz-bot@users.noreply.github.com",
            "boilerz-bot",
          ],
        ],
        "results": Array [
          Object {
            "type": "return",
            "value": Promise {},
          },
        ],
      }
    `);
  });
});
