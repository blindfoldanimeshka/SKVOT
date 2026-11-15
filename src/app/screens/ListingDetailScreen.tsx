import { ListingDetail } from '@/features/listings/ListingDetail'

interface ListingDetailScreenProps {
  id: string
  onBack: () => void
  onStartChat: (chatId: string) => void
  requireAuth?: (opts: { hint: string; resume?: 'chat' | null }) => void
  resumeStartChat?: boolean
}

export function ListingDetailScreen({
  id,
  onBack,
  onStartChat,
  requireAuth,
  resumeStartChat,
}: ListingDetailScreenProps) {
  return (
    <ListingDetail
      id={id}
      onBack={onBack}
      onStartChat={onStartChat}
      requireAuth={requireAuth}
      resumeStartChat={resumeStartChat}
    />
  )
}
