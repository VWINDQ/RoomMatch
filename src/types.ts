export type RoomStatus = 'available' | 'full' | 'inactive';
export type RequestStatus = 'pending' | 'approved' | 'rejected';

export type User = {
  userId: string;
  firstName: string;
  lastName: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  university: string;
  profileImage: string;
  bio: string;
  email: string;
  instagram: string;
  lineId: string;
  isActive?: boolean;
};

export type RoomImage = { imageId: string; imageUrl: string; imageOrder: number };

export type Room = {
  roomId: string;
  ownerId?: string;
  title: string;
  description: string;
  googleMapsUrl: string;
  price: number;
  capacity: number;
  status: RoomStatus;
  createdAt: string;
  owner?: User;
  images: RoomImage[];
  members?: RoomMember[];
  memberCount: number;
  availableSlots: number;
  isOwner?: boolean;
  requestStatus?: RequestStatus | null;
};

export type RoomMember = {
  userId: string;
  roomId?: string;
  status: string;
  joinedAt: string;
  user?: User;
};

export type JoinRequest = {
  requestId: string;
  roomId?: string;
  userId?: string;
  status: RequestStatus;
  requestedAt: string;
  respondedAt?: string;
  room?: Pick<Room, 'roomId' | 'title'> & Partial<Room>;
  requester?: Partial<User>;
};

export type Lifestyle = { lifestyleId?: string; lifestyleName: string };

export type Preference = {
  preferenceId?: string;
  preferredGender: string;
  preferredAgeMin: number | null;
  preferredAgeMax: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
};

export type ProfileBundle = { user: User; lifestyle: Lifestyle | null; preference: Preference | null };

export type Match = {
  matchId: string;
  roomId?: string;
  initiatorUserId?: string;
  completerUserId?: string;
  matchedAt: string;
  room?: Pick<Room, 'roomId' | 'title'> & Partial<Room>;
  otherUser?: Partial<User>;
};

export type RoomFilters = { minPrice: string; maxPrice: string };

export type FriendProfile = {
  userId: string; firstName: string; lastName: string; university: string;
  bio: string; profileImage: string; lifestyle: string;
  budgetMin: number | null; budgetMax: number | null;
  lineId?: string; instagram?: string; email?: string; phone?: string;
};
export type FriendConnection = {
  connectionId: string; direction: 'incoming' | 'outgoing';
  status: 'pending' | 'accepted' | 'declined'; createdAt: string; respondedAt: string;
  person: FriendProfile;
};
