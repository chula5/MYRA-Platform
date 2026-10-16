// Outside Next there is no page cache to revalidate; the onboarding path calls
// it after every scan, so the call simply does nothing here.
module.exports = { revalidatePath() {}, revalidateTag() {} }
