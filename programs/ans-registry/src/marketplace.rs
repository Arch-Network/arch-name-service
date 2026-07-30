use ans_protocol::state::{
    AccountHeader, ArchAddress, ListingAccount, OfferAccount, QuoteCurrency,
    LISTING_ACCOUNT_DISCRIMINATOR, OFFER_ACCOUNT_DISCRIMINATOR,
};

pub fn create_listing(
    name_hash: [u8; 32],
    seller: ArchAddress,
    currency: QuoteCurrency,
    price: u64,
) -> ListingAccount {
    ListingAccount {
        header: AccountHeader::initialized(LISTING_ACCOUNT_DISCRIMINATOR),
        name_hash,
        seller,
        currency,
        price,
        created_at_slot: 0,
        active: true,
    }
}

pub fn deactivate_listing(listing: &mut ListingAccount) {
    listing.active = false;
}

pub fn create_offer(
    name_hash: [u8; 32],
    buyer: ArchAddress,
    currency: QuoteCurrency,
    price: u64,
) -> OfferAccount {
    OfferAccount {
        header: AccountHeader::initialized(OFFER_ACCOUNT_DISCRIMINATOR),
        name_hash,
        buyer,
        currency,
        price,
        created_at_slot: 0,
        active: true,
    }
}

pub fn deactivate_offer(offer: &mut OfferAccount) {
    offer.active = false;
}
