import ReviewClient from './review-client';

export default async function ReviewPage({searchParams}) {
  const params=await searchParams;
  return <ReviewClient contactId={String(params?.contact||'')}/>;
}
