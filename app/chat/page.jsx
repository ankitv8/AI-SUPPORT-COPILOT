import ChatLayout from '../../components/ChatLayout'
import ChatExperience from '../../components/ChatExperience'

export const metadata = {
  title: 'Chat | AI Support Copilot',
  description:
    'Upload any file and chat with AI Support Copilot — like ChatGPT, grounded in your documents with source citations.',
}

export default function ChatPage() {
  return (
    <ChatLayout>
      <ChatExperience />
    </ChatLayout>
  )
}
