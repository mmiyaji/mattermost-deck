export async function cleanupPostsInBatches(
  postIds: string[],
  rootPostIds: string[],
  batchSize: number,
  deletePost: (postId: string) => Promise<void>,
): Promise<number> {
  const roots = new Set(rootPostIds);
  // Mattermost may remove a thread's replies along with its root. Finish all
  // reply deletes before starting root deletes so those requests cannot race.
  const phases = [
    postIds.filter((postId) => !roots.has(postId)).reverse(),
    rootPostIds.slice().reverse(),
  ];
  let failureCount = 0;
  for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
    const phase = phases[phaseIndex];
    for (let index = 0; index < phase.length; index += batchSize) {
      const batch = phase.slice(index, index + batchSize);
      const results = await Promise.allSettled(batch.map(deletePost));
      const batchFailureCount = results.filter(
        (result) => result.status === "rejected",
      ).length;
      failureCount += batchFailureCount;
      if (batchFailureCount === results.length) {
        const unattemptedInPhase = phase.length - index - batch.length;
        const unattemptedInLaterPhases = phases
          .slice(phaseIndex + 1)
          .reduce((count, laterPhase) => count + laterPhase.length, 0);
        return failureCount + unattemptedInPhase + unattemptedInLaterPhases;
      }
    }
  }
  return failureCount;
}
