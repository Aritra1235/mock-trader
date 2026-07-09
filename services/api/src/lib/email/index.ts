function sendEmail({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}) {
  const email = {
    to,
    subject,
    text,
  };

  //for dev we will just log the email to the console
  console.log(email);
}

export { sendEmail };
