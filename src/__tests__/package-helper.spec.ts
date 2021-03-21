import { getCurrentVersion } from '../package-helper';

describe('package-helper', () => {
  describe('#getCurrentVersion', () => {
    it('should return package version', async () => {
      expect(await getCurrentVersion()).toEqual(
        expect.stringMatching(/\d\.\d\.\d/),
      );
    });
  });
});
