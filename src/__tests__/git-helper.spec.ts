import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import { GitHub } from '@actions/github/lib/utils';
import MockDate from 'mockdate';

import {
  EnhancedCommit,
  detectBumpType,
  getCurrentBranch,
  version,
  areDiffWorthRelease,
  File,
  retrieveChangesSinceLastRelease,
  hasPendingDependencyPRsOpen,
} from '../git-helper';
import * as packageHelper from '../package-helper';
import { comparison, files } from './__fixtures/comparison';

function createCommit(message: string, sha?: string): EnhancedCommit {
  return {
    sha: sha || 'bac6aee2d316d65025022f9e84f12eb2ffcb34ac',
    html_url: 'http://somewhere.web',
    commit: {
      message,
    },
  } as EnhancedCommit;
}

describe('git-helper', () => {
  beforeEach(() => {
    jest.spyOn(github.context, 'repo', 'get').mockReturnValue({
      owner: 'jdoe',
      repo: 'foo',
    });
  });
  afterEach(MockDate.reset);

  describe('#getCurrentBranch', () => {
    it('should failed to detect branch without ref', () => {
      expect(
        getCurrentBranch.bind(null, undefined),
      ).toThrowErrorMatchingInlineSnapshot(`"Failed to detect branch"`);
    });

    it('should failed to detect branch without a well formed ref', () => {
      expect(
        getCurrentBranch.bind(null, 'o'),
      ).toThrowErrorMatchingInlineSnapshot(
        `"Cannot retrieve branch name from GITHUB_REF"`,
      );
    });

    it('should detect branch successfully', () => {
      expect(getCurrentBranch('refs/heads/master')).toEqual('master');
    });
  });

  describe('#detectBumpType', () => {
    it('should failed to detect bump type with not enough commits', () => {
      expect(detectBumpType.bind(null, [])).toThrowErrorMatchingInlineSnapshot(
        `"Failed to access commits"`,
      );
    });

    it('should return a minor bump type for features and minor message commit', () => {
      expect(
        detectBumpType([createCommit(':sparkles: feat something')]),
      ).toEqual('minor');
      expect(
        detectBumpType([createCommit(':sparkles: minor something else')]),
      ).toEqual('minor');
      expect(
        detectBumpType([createCommit(':sparkles: something else')]),
      ).toEqual('minor');
    });

    it('should return a patch bump type for any other commit type', () => {
      expect(detectBumpType([createCommit(':arrow_up: bump bar@1.0')])).toEqual(
        'patch',
      );
    });
  });

  describe('#version', () => {
    let execSpy: jest.SpyInstance;
    beforeEach(() => {
      execSpy = jest.spyOn(exec, 'exec').mockResolvedValue(0); // For safety
    });

    it('should version successfully', async () => {
      expect(await version('minor', 'john@doe.co', 'jdoe')).toBe(true);
      expect(await version('minor', 'john@doe.co', 'jdoe')).toBe(true);

      expect(execSpy.mock.calls).toMatchSnapshot();
    });

    it('should skip version is branch is behind', async () => {
      execSpy.mockRestore();
      jest
        .spyOn(exec, 'exec')
        .mockImplementation(async (command, args, options): Promise<number> => {
          if (command === 'git' && (args || []).includes('-uno')) {
            const stdout = Buffer.from(
              `Your branch is behind 'origin/master' by 6 commits, and can be fast-forwarded.`,
              'utf-8',
            );
            options?.listeners?.stdout?.(stdout);
          }
          return 0;
        });

      expect(await version('minor', 'john@doe.co', 'jdoe')).toBe(false);
    });
  });

  describe('#areDiffWorthRelease', () => {
    it('should not worth a release', async () => {
      jest
        .spyOn(packageHelper, 'getDevDependencies')
        .mockResolvedValue(['eslint']);
      const versionFiles = [
        {
          filename: 'package.json',
          patch: `
          @@ -1,6 +1,6 @@
           "name": "@boilerz/super-server-auth-core",
        -  "version": "1.6.12",
        +  "version": "1.6.13",
           "repository": "git@github.com:boilerz/super-server-auth-core.git",
           `,
        },
      ] as File[];
      const unworthyReleaseFiles = [
        { filename: '.github/workflows/ci.yml' },
        { filename: '.husky/pre-commit' },
        { filename: '.eslintignore' },
        { filename: '.eslintrc' },
        { filename: '.gitignore' },
        { filename: '.yarnrc' },
        { filename: 'LICENCE' },
        { filename: 'README' },
        { filename: 'tsconfig' },
      ] as File[];

      expect(
        await areDiffWorthRelease({
          files: versionFiles,
          commits: [createCommit('non dev dep')],
        }),
      ).toBe(false);
      expect(
        await areDiffWorthRelease({
          files: unworthyReleaseFiles,
          commits: [
            createCommit('non dev dep'),
            createCommit(':arrow_up: Bump eslint from 7.18.0 to 7.19.0'),
          ],
        }),
      ).toBe(false);
    });

    it('should not worth a release when comparison detect only dev dependency update', async () => {
      const infoSpy = jest.spyOn(core, 'info');
      jest
        .spyOn(packageHelper, 'getDevDependencies')
        .mockResolvedValue(['eslint']);

      expect(
        await areDiffWorthRelease({
          files: [],
          commits: [
            createCommit('Merge commit'),
            createCommit(':arrow_up: Bump eslint from 7.18.0 to 7.19.0'),
          ],
        }),
      ).toBe(false);
      expect(infoSpy).toHaveBeenLastCalledWith(
        '👨‍💻 Commits contain only dev dependencies update',
      );
    });

    it('should worth a release', async () => {
      expect(
        await areDiffWorthRelease({
          files,
          commits: [
            createCommit(':arrow_up: Bump eslint from 7.18.0 to 7.19.0'),
            createCommit('non dev dep'),
          ],
        }),
      ).toBe(true);
    });
  });

  describe('#retrieveChangesSinceLastRelease', () => {
    let listTagsSpy: jest.SpyInstance;
    let listCommitsSpy: jest.SpyInstance;
    let compareCommitsSpy: jest.SpyInstance;

    beforeEach(() => {
      listTagsSpy = jest.fn();
      listCommitsSpy = jest.fn().mockResolvedValue({
        data: [
          createCommit('1', '1'),
          createCommit('2', '2'),
          createCommit('3', '3'),
          createCommit('4', '4'),
        ],
      });
      compareCommitsSpy = jest.fn();
      jest.spyOn(github, 'getOctokit').mockReturnValue({
        repos: {
          listTags: listTagsSpy,
          listCommits: listCommitsSpy,
          compareCommits: compareCommitsSpy,
        },
      } as unknown as InstanceType<typeof GitHub>);
    });

    it('should retrieve changes since last release using oldest commit', async () => {
      listTagsSpy.mockResolvedValue({ data: [] });
      compareCommitsSpy.mockResolvedValue({ data: comparison });

      await retrieveChangesSinceLastRelease('github.token');

      expect(compareCommitsSpy.mock.calls).toMatchInlineSnapshot(`
        Array [
          Array [
            Object {
              "base": "4",
              "head": "1",
              "owner": "jdoe",
              "repo": "foo",
            },
          ],
        ]
      `);
    });

    it('should retrieve changes since last release using latest tag', async () => {
      listTagsSpy.mockResolvedValue({
        data: [{ name: 'v1.0.2' }, { name: 'v1.0.1' }],
      });
      compareCommitsSpy.mockResolvedValue({ data: comparison });

      await retrieveChangesSinceLastRelease('github.token');

      expect(compareCommitsSpy.mock.calls).toMatchInlineSnapshot(`
        Array [
          Array [
            Object {
              "base": "v1.0.2",
              "head": "1",
              "owner": "jdoe",
              "repo": "foo",
            },
          ],
        ]
      `);
    });
  });

  describe('#hasPendingDependencyPRsOpen', () => {
    let listSpy: jest.SpyInstance;

    beforeEach(() => {
      listSpy = jest.fn();
      jest.spyOn(github, 'getOctokit').mockReturnValue({
        pulls: {
          list: listSpy,
        },
      } as unknown as InstanceType<typeof GitHub>);
    });

    it('should return true if dependencies PR are open', async () => {
      listSpy.mockResolvedValue({
        data: [
          { labels: [{ name: 'dependencies' }] },
          { labels: [{ name: 'automerge' }] },
        ],
      });

      expect(await hasPendingDependencyPRsOpen('github.token')).toBe(true);
    });

    it('should return false if no dependencies PR are open', async () => {
      listSpy.mockResolvedValue({
        data: [{ labels: [{ name: 'automerge' }] }],
      });

      expect(await hasPendingDependencyPRsOpen('github.token')).toBe(false);
    });
  });
});
