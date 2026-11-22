export type RoomStatus = 'available' | 'full' | 'inactive';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type PriceBasis = 'per_room' | 'per_person';

export type User = {
  userId: string;
  firstName: string;
  lastName: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  university: string;
  accountType?: string;
  profileSetupPending?: boolean;
  profileReminderSeen?: boolean;
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
  priceBasis?: PriceBasis | null;
  locality?: string;
  costNotes?: string;
  capacity: number;
  ownerIsResident: boolean;
  occupantCount: number;
  status: RoomStatus;
  createdAt: string;
  owner?: User;
  images: RoomImage[];
  members?: RoomMember[];
  ownerResidentProfile?: RoommateProfile;
  memberCount: number;
  availableSlots: number;
  isOwner?: boolean;
  isMember?: boolean;
  isFavorite?: boolean;
  requestStatus?: RequestStatus | null;
  pendingRequestId?: string | null;
};

export type RoomMember = {
  userId: string;
  roomId?: string;
  status: string;
  joinedAt: string;
  user?: User;
  profile?: RoommateProfile;
};

export type JoinRequest = {
  membershipActive?: boolean;
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
  otherRole?: 'owner' | 'member';
};

export type RoomFilters = { minPrice: string; maxPrice: string; capacity: string; minSlots: string; priceBasis: string };

export type RoommateProfile = {
  userId: string; firstName: string; lastName: string; university: string;
  age: number | null;
  gender: string;
  preferredGender: string;
  preferredAgeMin: number | null; preferredAgeMax: number | null;
  bio: string; profileImage: string; lifestyle: string;
  budgetMin: number | null; budgetMax: number | null;
};
export type FriendProfile = RoommateProfile & {
  lineId?: string; instagram?: string; email?: string; phone?: string;
};
export type FriendConnection = {
  connectionId: string; direction: 'incoming' | 'outgoing';
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'; createdAt: string; respondedAt: string;
  person: FriendProfile;
};
